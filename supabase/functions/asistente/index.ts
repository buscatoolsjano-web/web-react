/**
 * El asistente: la frontera con el mundo (Fase 31 · E3).
 *
 * Recibe la conversación, arma el entorno —proveedor y ejecutor— y corre el
 * bucle. Todo lo que se puede decidir sin HTTP, sin secrets y sin base vive en
 * `bucle.ts`, `agentes.ts` y `herramientas.ts`, que corren en vitest.
 *
 * Nada de lo que pasa acá escribe en la base: por ahora el asistente sólo LEE.
 * Que pueda crear una cotización es otra decisión y va a necesitar su propia
 * confirmación en pantalla.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0'
import { type Mensaje, responder } from './bucle.ts'
import { crearEjecutor } from './ejecutor.ts'
import { FalloProveedor, proveedorConfigurado } from './proveedor.ts'
import { AGENTE_RAIZ, agente, todosLosAgentes } from './agentes.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

const falla = (motivo: string, mensaje: string, status = 400) =>
  json({ error: { motivo, mensaje } }, status)

/** Cuántos mensajes de la charla se le pasan al modelo. */
const HISTORIAL = 12

/** Los mensajes que llegaron, validados. Lo que no tenga forma, se descarta. */
function mensajesDe(crudo: unknown): Mensaje[] {
  if (!Array.isArray(crudo)) return []
  return crudo
    .slice(-HISTORIAL)
    .map((m): Mensaje | null => {
      const o = (m ?? {}) as { rol?: unknown; texto?: unknown }
      if (typeof o.texto !== 'string' || o.texto.trim() === '') return null
      // Sólo los dos roles de una charla: las llamadas a herramientas son de
      // adentro del bucle y no se aceptan desde afuera. Dejar que el navegador
      // inyecte un `rol: 'herramienta'` sería dejarlo inventar resultados.
      if (o.rol === 'agente') return { rol: 'agente', texto: o.texto }
      if (o.rol === 'usuario') return { rol: 'usuario', texto: o.texto }
      return null
    })
    .filter((m): m is Mensaje => m !== null)
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  /**
   * GET: en qué estado está, sin gastar nada.
   *
   * Es lo que le permite a la pantalla mostrar «IA activa» y que sea verdad.
   * Devuelve también los agentes, para que la pantalla los muestre sin tener
   * una copia de la lista que se desincronice.
   */
  if (req.method === 'GET') {
    const p = proveedorConfigurado()
    return json({
      proveedor: p.nombre,
      listo: p.listo,
      agentes: todosLosAgentes().map((a) => ({ id: a.id, titulo: a.titulo, paraQue: a.paraQue })),
    })
  }
  if (req.method !== 'POST') return falla('metodo', 'Sólo GET o POST.', 405)

  const cabecera = req.headers.get('Authorization') ?? ''
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : ''
  if (token === '') return falla('sin_sesion', 'Hay que estar logueado.', 401)

  let cuerpo: { companyId?: unknown; mensajes?: unknown; agente?: unknown }
  try {
    cuerpo = (await req.json()) as typeof cuerpo
  } catch {
    return falla('cuerpo', 'El cuerpo tiene que ser JSON.')
  }

  const companyId = typeof cuerpo.companyId === 'string' ? cuerpo.companyId : ''
  if (companyId === '') return falla('sin_empresa', 'Falta la empresa.')

  const mensajes = mensajesDe(cuerpo.mensajes)
  if (mensajes.length === 0) return falla('sin_mensaje', 'No llegó ningún mensaje.')

  const inicial = typeof cuerpo.agente === 'string' && agente(cuerpo.agente)
    ? cuerpo.agente
    : AGENTE_RAIZ

  /**
   * Quién pregunta y a qué empresa.
   *
   * Se resuelve contra la base CON SU PROPIO TOKEN: si dice pertenecer a una
   * empresa que no es suya, la consulta vuelve vacía y no hay nada que
   * comprobar a mano. La misma RLS que protege la pantalla protege esto.
   */
  const comoElUsuario = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )

  const { data: usuario } = await comoElUsuario.auth.getUser()
  const userId = usuario?.user?.id ?? ''
  if (userId === '') return falla('sin_sesion', 'La sesión no es válida.', 401)

  const { data: empresa } = await comoElUsuario
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .maybeSingle()
  if (!empresa) return falla('sin_empresa', 'Esa empresa no es tuya.', 403)

  const proveedor = proveedorConfigurado()

  /**
   * Lo que el agente tiene que saber de ESTA consulta.
   *
   * La fecha, sobre todo. Sin ella, «el mejor cliente de agosto» se contestaba
   * preguntando de qué año, y tenía razón: no lo podía saber. Va en la zona
   * horaria de Buenos Aires, que es donde se trabaja: a las 21 de Argentina,
   * en UTC ya es mañana, y «lo de hoy» sería el día equivocado.
   *
   * Y quién pregunta, que es lo que le da sentido a «¿qué tengo pendiente?».
   */
  const ahora = new Date().toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const meta = (usuario.user.user_metadata ?? {}) as { full_name?: unknown; nombre?: unknown }
  const quien =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.nombre === 'string' && meta.nombre) ||
    usuario.user.email ||
    'alguien de la empresa'
  const contexto = `CONTEXTO DE ESTA CONSULTA\nHoy es ${ahora}. Cuando digan un mes sin año, es el más reciente que ya pasó.\nQuien pregunta es ${quien}.`

  try {
    const r = await responder(
      {
        modelo: (pedido) => proveedor.responder(pedido),
        ejecutar: crearEjecutor({ token, companyId, userId }),
        contexto,
      },
      mensajes,
      inicial,
    )
    return json({
      texto: r.texto,
      // La traza se muestra: «consulté a Catálogo, busqué productos». Es lo
      // que convierte una espera muda en algo que se entiende, y lo que
      // permite ver de dónde salió un dato cuando parece raro.
      pasos: r.pasos.map((p) => ({ agente: p.agente, tipo: p.tipo, nombre: p.nombre })),
      llamadas: r.llamadas,
      corte: r.corte,
      proveedor: proveedor.nombre,
    })
  } catch (e) {
    if (e instanceof FalloProveedor) {
      const mensajes: Record<string, string> = {
        sin_configurar: 'La IA todavía no está configurada.',
        rechazo: 'El proveedor de IA rechazó la consulta.',
        limite: 'Se alcanzó el límite del proveedor de IA. Probá en un rato.',
        caido: 'El proveedor de IA no responde.',
      }
      return falla(e.motivo, mensajes[e.motivo] ?? 'No pude consultar la IA.', 502)
    }
    return falla('interno', 'No pude responder en este momento.', 500)
  }
})
