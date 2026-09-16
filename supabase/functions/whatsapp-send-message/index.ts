/**
 * whatsapp-send-message — el único camino por el que sale un WhatsApp.
 *
 *   POST { conversation_id, texto, client_request_id }
 *
 * El navegador manda TRES cosas y ninguna es el destinatario: el número, la
 * cuenta y el `phone_number_id` se resuelven acá a partir de la conversación.
 * Un cliente que pudiera elegir destinatario podría usar el número de la
 * empresa para escribirle a cualquiera.
 *
 * Orden de cada pedido:
 *   1. JWT verificado;
 *   2. cuerpo validado, sin campos extra;
 *   3. la BASE valida al actor: que pueda ver la conversación, que su rol
 *      escriba, que la cuenta esté activa y que la ventana de 24 h esté
 *      abierta (`encolar_mensaje_whatsapp`, SECURITY DEFINER);
 *   4. el mensaje queda `pending` con su `client_request_id` — dos clics dejan
 *      UNA fila, porque hay un índice único;
 *   5. se llama a Graph con el token del servidor;
 *   6. se sella el resultado.
 *
 * Si el paso 5 o el 6 se caen, el mensaje queda `pending` y lo levanta el
 * reciclador. NO se reintenta a ciegas: Meta no tiene clave de idempotencia
 * para el envío, así que repetir un POST que quizá salió es mandárselo dos
 * veces al cliente.
 *
 * El token nunca sale de acá. No se devuelve, no se registra, no se propaga en
 * un mensaje de error.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  CODIGOS_BASE,
  ORIGENES_PERMITIDOS,
  codigoDeErrorBase,
  cuerpoDeTexto,
  interpretarErrorMeta,
  mensajeParaLaPersona,
  validarPedido,
} from './logica.ts'

const URL_BASE = Deno.env.get('SUPABASE_URL')!
const CLAVE_SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const ACCESS_TOKEN = Deno.env.get('META_WHATSAPP_ACCESS_TOKEN')
const GRAPH = Deno.env.get('META_GRAPH_VERSION') ?? 'v23.0'

const admin = createClient(URL_BASE, CLAVE_SERVICIO, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function cors(origen: string | null): Record<string, string> {
  if (!origen || !(ORIGENES_PERMITIDOS as readonly string[]).includes(origen)) return { Vary: 'Origin' }
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

function registrar(datos: Record<string, unknown>) {
  console.log(JSON.stringify({ fn: 'whatsapp-send-message', ...datos }))
}

Deno.serve(async (req) => {
  const origen = req.headers.get('Origin')
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 'Access-Control-Allow-Origin' in cors(origen) ? 204 : 403,
      headers: cors(origen),
    })
  }
  if (req.method !== 'POST') return responder(origen, 405, { error: 'metodo_no_permitido' })

  const inicio = Date.now()
  const autorizacion = req.headers.get('Authorization')
  if (!autorizacion?.startsWith('Bearer ')) return responder(origen, 401, { error: 'sin_sesion' })

  // 1 · La sesión de quien manda.
  const comoUsuario = createClient(URL_BASE, ANON, {
    global: { headers: { Authorization: autorizacion } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: sesion, error: errorSesion } = await comoUsuario.auth.getUser()
  if (errorSesion || !sesion?.user) return responder(origen, 401, { error: 'sin_sesion' })

  // 2 · El cuerpo.
  let cuerpo: unknown
  try {
    cuerpo = await req.json()
  } catch {
    return responder(origen, 400, { error: 'datos_invalidos' })
  }
  const pedido = validarPedido(cuerpo)
  if ('error' in pedido) return responder(origen, 400, pedido)

  // 3 y 4 · La base valida al actor y encola. Va con el JWT de la persona:
  //         la autorización la decide la base, no esta función.
  const { data: encolado, error: errorEncolar } = await comoUsuario.rpc('encolar_mensaje_whatsapp', {
    p_conversacion: pedido.conversationId,
    p_texto: pedido.texto,
    p_client_request_id: pedido.clientRequestId,
  })

  if (errorEncolar) {
    const codigo = codigoDeErrorBase(errorEncolar.message)
    if (codigo) {
      registrar({ evento: 'rechazado', codigo, ms: Date.now() - inicio })
      return responder(origen, CODIGOS_BASE[codigo]!, { error: codigo })
    }
    console.error('whatsapp-send-message: error de base', errorEncolar.message.slice(0, 200))
    return responder(origen, 500, { error: 'error_interno' })
  }

  const mensaje = encolado as { id: string; conversation_id: string; status: string; provider_message_id: string | null } | null
  if (!mensaje?.id) return responder(origen, 500, { error: 'error_interno' })

  // Reenvío del mismo `client_request_id`: ya salió. No se manda de nuevo.
  if (mensaje.provider_message_id) {
    registrar({ evento: 'idempotente', mensaje: mensaje.id, ms: Date.now() - inicio })
    return responder(origen, 200, { message_id: mensaje.id, estado: mensaje.status, repetido: true })
  }

  if (!ACCESS_TOKEN) {
    registrar({ evento: 'sin_token', mensaje: mensaje.id })
    return responder(origen, 503, { error: 'integracion_incompleta' })
  }

  // 5 · A dónde y por dónde. Los dos salen de la conversación.
  const { data: destino, error: errorDestino } = await admin
    .from('whatsapp_conversations')
    .select('phone_e164, provider_contact_id, whatsapp_accounts!account_id ( phone_number_id, active )')
    .eq('id', mensaje.conversation_id)
    .maybeSingle()

  const cuenta = (destino as { whatsapp_accounts?: { phone_number_id: string; active: boolean } } | null)
    ?.whatsapp_accounts
  const numero = destino?.provider_contact_id ?? destino?.phone_e164?.replace('+', '')
  if (errorDestino || !cuenta?.phone_number_id || !numero) {
    await admin.rpc('sellar_saliente_whatsapp', {
      p_mensaje: mensaje.id, p_provider_message_id: null,
      p_error_code: null, p_error_details: 'no se pudo resolver el destinatario',
    })
    return responder(origen, 500, { error: 'error_interno' })
  }

  // 6 · Graph.
  let respuesta: Response
  try {
    respuesta = await fetch(`https://graph.facebook.com/${GRAPH}/${cuenta.phone_number_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpoDeTexto(numero, pedido.texto)),
    })
  } catch (e) {
    // Ni siquiera se llegó a Meta: el mensaje queda `pending` para el reciclador.
    registrar({ evento: 'red_caida', mensaje: mensaje.id, ms: Date.now() - inicio })
    console.error('whatsapp-send-message: red', e instanceof Error ? e.message.slice(0, 120) : 'error')
    return responder(origen, 502, { error: 'meta_inalcanzable' })
  }

  const datos = await respuesta.json().catch(() => ({}))

  if (!respuesta.ok) {
    const e = interpretarErrorMeta(respuesta.status, datos)
    await admin.rpc('sellar_saliente_whatsapp', {
      p_mensaje: mensaje.id,
      p_provider_message_id: null,
      p_error_code: e.code,
      p_error_details: e.detalle,
    })
    registrar({
      evento: 'meta_rechazo', mensaje: mensaje.id, status: e.status,
      code: e.code, subcode: e.subcode, ms: Date.now() - inicio,
    })
    return responder(origen, 502, {
      error: 'meta_rechazo',
      detalle: mensajeParaLaPersona(e),
      code: e.code,
      reintentable: e.reintentable,
    })
  }

  const wamid = (datos as { messages?: { id?: string }[] })?.messages?.[0]?.id ?? null
  const { data: sellado, error: errorSellar } = await admin.rpc('sellar_saliente_whatsapp', {
    p_mensaje: mensaje.id,
    p_provider_message_id: wamid,
    p_error_code: null,
    p_error_details: wamid ? null : 'Meta aceptó sin devolver id',
  })
  if (errorSellar) {
    // Salió de verdad; sólo no se pudo anotar. El reciclador NO lo reenvía.
    console.error('whatsapp-send-message: sellar', errorSellar.message.slice(0, 200))
  }

  registrar({ evento: 'enviado', mensaje: mensaje.id, ms: Date.now() - inicio })
  return responder(origen, 200, {
    message_id: mensaje.id,
    estado: (sellado as { status?: string } | null)?.status ?? 'sent',
  })
})
