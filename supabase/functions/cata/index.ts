/**
 * Cata: la frontera con el mundo (Fase 85).
 *
 * Recibe la transcripción de lo que alguien dijo por teléfono, corre el bucle
 * de siempre con el agente del catálogo y devuelve el texto que hay que decir
 * en voz alta. Todo lo que se puede decidir sin HTTP vive en `logica.ts`, que
 * corre en vitest.
 *
 * ── LO QUE NO HAY ACÁ, Y ES EL PUNTO ────────────────────────────────────────
 *
 * No hay elección de agente: el que llama no manda ningún `agente`, porque la
 * única respuesta posible es la del catálogo. No hay bandeja: no hay tarjetas
 * de producto ni borrador de cotización que mostrar, esto se escucha. No hay
 * streaming: una voz no se puede empezar a decir a medias y corregirla
 * después. Y no hay escritura en la base: las cuatro herramientas son RPC de
 * lectura.
 *
 * ── LA VOZ NO PASA POR ACÁ ──────────────────────────────────────────────────
 *
 * Ni la de entrada ni la de salida. El navegador transcribe con
 * `SpeechRecognition` y habla con `speechSynthesis`, que ya vienen en Chrome y
 * no se pagan. Por eso esta función recibe y devuelve texto igual que el chat:
 * lo que cambia es cómo se habla, no por dónde viaja.
 *
 * Si algún día la llamada entra por teléfono de verdad, acá no hay que tocar
 * nada: el que cambia es quien transcribe.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0'
import { type Mensaje, responder } from '../asistente/bucle.ts'
import { crearEjecutor } from '../asistente/ejecutor.ts'
import { FalloProveedor, proveedorConfigurado } from '../asistente/proveedor.ts'
import {
  AGENTE_DE_CATA,
  contextoDeLlamada,
  HERRAMIENTAS_DE_CATA,
  soloCatalogo,
} from './logica.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

const falla = (motivo: string, mensaje: string, status = 400) =>
  json({ error: { motivo, mensaje } }, status)

/**
 * Cuántos turnos de la llamada se le pasan al modelo.
 *
 * Menos que los doce del chat escrito, y a propósito: un turno de teléfono son
 * dos frases, no un párrafo, así que ocho turnos son el mismo contexto en
 * menos tokens. Y una llamada no se relee: lo que se dijo hace cinco minutos
 * ya no lo tiene en la cabeza ni quien llamó.
 */
const TURNOS = 8

/**
 * Lo más largo que se acepta de una sola vez.
 *
 * `SpeechRecognition` con `continuous` puede mandar un párrafo entero si
 * alguien habló sin pausas, pero mil caracteres son como tres minutos de
 * habla: más que eso no es una frase de teléfono, es un pegado.
 */
const MAX_LARGO = 1_000

const MENSAJES_DE_FALLO: Record<string, string> = {
  sin_configurar: 'La IA todavía no está configurada.',
  rechazo: 'No pude procesar eso.',
  limite: 'Se alcanzó el límite del proveedor de IA. Probá en un rato.',
  caido: 'El proveedor de IA no responde.',
}

/** Los turnos que llegaron, validados. Lo que no tenga forma, se descarta. */
function turnosDe(crudo: unknown): Mensaje[] {
  if (!Array.isArray(crudo)) return []
  return crudo
    .slice(-TURNOS)
    .map((m): Mensaje | null => {
      const o = (m ?? {}) as { rol?: unknown; texto?: unknown }
      if (typeof o.texto !== 'string' || o.texto.trim() === '') return null
      const texto = o.texto.slice(0, MAX_LARGO)
      // Sólo los dos roles de una charla. Un `rol: 'herramienta'` desde el
      // navegador sería dejarlo inventar resultados de catálogo, que es
      // exactamente lo que el candado de `logica.ts` evita por el otro lado.
      if (o.rol === 'agente') return { rol: 'agente', texto }
      if (o.rol === 'usuario') return { rol: 'usuario', texto }
      return null
    })
    .filter((m): m is Mensaje => m !== null)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return falla('metodo', 'Sólo POST.', 405)

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (token === '') return falla('sin_sesion', 'Falta la sesión.', 401)

  let cuerpo: { companyId?: unknown; turnos?: unknown }
  try {
    cuerpo = (await req.json()) as typeof cuerpo
  } catch {
    return falla('cuerpo', 'El cuerpo tiene que ser JSON.')
  }

  const companyId = typeof cuerpo.companyId === 'string' ? cuerpo.companyId : ''
  if (companyId === '') return falla('sin_empresa', 'Falta la empresa.')

  const turnos = turnosDe(cuerpo.turnos)
  if (turnos.length === 0) return falla('sin_mensaje', 'No llegó nada de la llamada.')

  /**
   * Quién llama y a qué empresa, con SU PROPIO TOKEN.
   *
   * Igual que el asistente escrito: si dice pertenecer a una empresa que no es
   * suya, la consulta vuelve vacía. La misma RLS que protege la pantalla
   * protege esto, y las dos comprobaciones van juntas porque no se necesitan
   * entre sí.
   */
  const comoElUsuario = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )

  const [{ data: usuario }, { data: empresa }] = await Promise.all([
    comoElUsuario.auth.getUser(),
    comoElUsuario.from('companies').select('id').eq('id', companyId).maybeSingle(),
  ])

  const userId = usuario?.user?.id ?? ''
  if (userId === '') return falla('sin_sesion', 'La sesión no es válida.', 401)
  if (!empresa) return falla('sin_empresa', 'Esa empresa no es tuya.', 403)

  const proveedor = proveedorConfigurado()

  const hoy = new Date().toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  /**
   * El ejecutor de siempre, con el candado puesto encima.
   *
   * `crearEjecutor` es la frontera de seguridad entera —corre con el JWT de
   * quien llama, pone la empresa desde el contexto y nunca deja que el modelo
   * mande un identificador—, así que no se toca. `soloCatalogo` le agrega lo
   * único que le falta para esta puerta: que el nombre de la herramienta
   * también esté permitido. Ver el por qué en `logica.ts`.
   */
  const ejecutar = soloCatalogo(crearEjecutor({ token, companyId, userId }))

  try {
    const r = await responder(
      {
        modelo: (pedido) => proveedor.responder(pedido),
        ejecutar,
        /**
         * Las mismas que permite el candado, OFRECIDAS.
         *
         * Las dos listas tienen que ser la misma. Permitir sin ofrecer deja
         * una herramienta que el modelo no ve y nunca usa —le pasó a
         * `ultimo_costo`—; ofrecer sin permitir lo deja golpeando una puerta
         * cerrada. Por eso es la misma constante, y no dos.
         */
        herramientas: HERRAMIENTAS_DE_CATA,
        contexto: contextoDeLlamada(hoy),
      },
      turnos,
      AGENTE_DE_CATA,
    )

    return json({
      texto: r.texto,
      // Qué consultó, para poder mirar de dónde salió un dato cuando una
      // respuesta hablada suena raro. No se dice en voz alta: se muestra.
      pasos: r.pasos.map((p) => ({ nombre: p.nombre })),
      llamadas: r.llamadas,
      proveedor: proveedor.nombre,
    })
  } catch (e) {
    if (e instanceof FalloProveedor) {
      const mensaje = MENSAJES_DE_FALLO[e.motivo] ?? 'No pude contestar.'
      return falla(e.motivo, mensaje, e.motivo === 'sin_configurar' ? 503 : 502)
    }
    console.error('cata', e)
    return falla('error', 'No pude contestar.', 500)
  }
})
