/**
 * whatsapp-ai-analyze — actualizar el resumen IA de UNA conversación.
 *
 *   POST { conversation_id, completo? }
 *
 * A demanda: lo dispara una persona con «Actualizar resumen». El análisis
 * automático NO pasa por acá: lo hace `whatsapp-ai-worker` desde la cola
 * (Fase 16 · E3), con el mismo `analisis.ts` y las mismas guardas.
 *
 * Orden de cada pedido:
 *   1. JWT verificado (verify_jwt) y usuario resuelto;
 *   2. cuerpo cerrado: sin `company_id` ni ningún campo extra;
 *   3. la conversación se lee con el JWT de la PERSONA: si la RLS no la deja
 *      verla, es 404 — no se confirma que exista;
 *   4. recién ahí el análisis corre con service_role, que es quien puede leer
 *      los mensajes enteros y escribir el resultado.
 *
 * La empresa nunca viene del cliente: sale de la conversación.
 *
 * Lo que se registra: códigos, conteos y tiempos. Ni un fragmento de mensaje,
 * ni el prompt, ni la respuesta del modelo, ni la clave del proveedor.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { esPedidoDeVerificacion, validarPedidoAnalisis } from './logica.ts'
import { analizarConversacion } from './analisis.ts'
import { proveedorConfigurado } from './proveedor.ts'

const URL_BASE = Deno.env.get('SUPABASE_URL')!
const CLAVE_SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!

const ORIGENES_PERMITIDOS = ['https://app.buscatools.com', 'http://localhost:5173', 'http://localhost:3000']

const admin = createClient(URL_BASE, CLAVE_SERVICIO, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Uno por worker: la verificación del modelo se hace una vez, no en cada
// pedido. Un cambio de secrets levanta workers nuevos, con la config nueva.
const proveedor = proveedorConfigurado()

function cors(origen: string | null): Record<string, string> {
  if (!origen || !ORIGENES_PERMITIDOS.includes(origen)) return { Vary: 'Origin' }
  return {
    'Access-Control-Allow-Origin': origen,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

function responder(origen: string | null, status: number, cuerpo: Record<string, unknown>): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...cors(origen), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

const STATUS: Record<string, number> = {
  ok: 200,
  sin_cambios: 200,
  reciente: 200,
  obsoleto: 409,
  desactivada: 403,
  limite: 429,
  no_soportado: 422,
  error: 502,
}

Deno.serve(async (req) => {
  const origen = req.headers.get('Origin')
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 'Access-Control-Allow-Origin' in cors(origen) ? 204 : 403, headers: cors(origen) })
  }
  if (req.method !== 'POST') return responder(origen, 405, { error: 'metodo_no_permitido' })

  const autorizacion = req.headers.get('Authorization')
  if (!autorizacion?.startsWith('Bearer ')) return responder(origen, 401, { error: 'sin_sesion' })

  const comoUsuario = createClient(URL_BASE, ANON, {
    global: { headers: { Authorization: autorizacion } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: sesion, error: errorSesion } = await comoUsuario.auth.getUser()
  if (errorSesion || !sesion?.user) return responder(origen, 401, { error: 'sin_sesion' })

  let cuerpo: unknown
  try {
    cuerpo = await req.json()
  } catch {
    return responder(origen, 400, { error: 'datos_invalidos' })
  }
  // Verificación del modelo: sin conversación y sin contenido. Sólo admin y
  // employee de alguna empresa con WhatsApp (lo mismo que ve las corridas).
  if (esPedidoDeVerificacion(cuerpo)) {
    const { data: membresia } = await comoUsuario
      .from('company_memberships')
      .select('role')
      .eq('user_id', sesion.user.id)
      .eq('status', 'active')
      .in('role', ['admin', 'employee'])
      .limit(1)
    if (!membresia || membresia.length === 0) return responder(origen, 403, { error: 'sin_permiso' })
    if (!proveedor.verificarModelo) {
      return responder(origen, 200, { proveedor: proveedor.nombre, verificable: false })
    }
    const v = await proveedor.verificarModelo()
    console.log(JSON.stringify({ fn: 'whatsapp-ai-analyze', evento: 'verificar_modelo', proveedor: proveedor.nombre, disponible: v.disponible, codigo: v.codigo }))
    return responder(origen, 200, { proveedor: proveedor.nombre, modelo: v.modelo, disponible: v.disponible, codigo: v.codigo })
  }

  const pedido = validarPedidoAnalisis(cuerpo)
  if ('error' in pedido) return responder(origen, 400, pedido)

  // La autorización: la conversación, leída con la RLS de quien pide.
  const { data: visible } = await comoUsuario
    .from('whatsapp_conversations')
    .select('id')
    .eq('id', pedido.conversationId)
    .maybeSingle()
  if (!visible) return responder(origen, 404, { error: 'conversacion_inexistente' })

  const r = await analizarConversacion({
    admin,
    proveedor,
    conversacionId: pedido.conversationId,
    completo: pedido.completo,
    solicitadoPor: sesion.user.id,
  })

  console.log(JSON.stringify({
    fn: 'whatsapp-ai-analyze', proveedor: proveedor.nombre, estado: r.estado, codigo: r.codigo ?? null,
    mensajes: r.mensajesEnviados ?? 0, resumen_previo: r.resumenPrevioIncluido ?? null,
    viejos_reenviados: r.mensajesViejosReenviados ?? null, items_nuevos: r.itemsNuevos ?? 0,
    items_repetidos: r.itemsRepetidos ?? 0,
    descartados: r.itemsDescartados ?? 0, alias_inventados: r.aliasInventados ?? 0,
    ms: r.duracionMs ?? null,
  }))

  return responder(origen, STATUS[r.estado] ?? 500, {
    estado: r.estado,
    codigo: r.codigo ?? null,
    items_nuevos: r.itemsNuevos ?? 0,
    items_descartados: r.itemsDescartados ?? 0,
  })
})
