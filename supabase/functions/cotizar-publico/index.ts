/**
 * El pedido de cotización del sitio público: la frontera (Fase 87 · E3).
 *
 * ── POR QUÉ ESTO EXISTE Y NO ES UN `insert` DESDE EL NAVEGADOR ─────────────
 *
 * Porque un `insert` desde el navegador necesita que la tabla tenga una
 * política que deje escribir a `anon`, y esa política es incondicional: no
 * puede contar cuántos pedidos mandó la misma conexión en la última hora, ni
 * recortar un mensaje de cuarenta mil caracteres, ni mirar una trampa para
 * robots. Lo único que puede hacer es decir que sí.
 *
 * Así que la tabla NO tiene política de inserción para nadie, y la única
 * forma de que entre una fila es esta función, que corre con la clave de
 * servicio. Lo que justifica ese privilegio es lo que hace antes de escribir,
 * y eso vive en `logica.ts`, que es puro y está probado.
 *
 * ── LO QUE SE LE CREE A QUIEN LLAMA, Y LO QUE NO ───────────────────────────
 *
 * Se le cree el nombre, el correo, el teléfono y el texto: son suyos y los
 * está dando a propósito. NO se le cree ni la empresa a la que le escribe
 * —eso lo decide la base, con el interruptor `catalogo_publico`— ni los
 * precios ni ningún id interno, que no viajan en ninguna dirección.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0'
import { huellaDeOrigen, MAXIMO_POR_HORA, revisar } from './logica.ts'

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

/**
 * Lo que se le contesta a quien está llenando el formulario.
 *
 * Nunca el detalle de por qué: «ya mandaste tres en la última hora» le dice a
 * un robot exactamente cuál es el límite y cada cuánto reintentar. A una
 * persona que de verdad consulta, el número tampoco le sirve de nada.
 */
const LISTO = { ok: true, mensaje: 'Recibimos tu consulta. Te contestamos a la brevedad.' }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, mensaje: 'Sólo POST.' }, 405)

  let cuerpo: unknown
  try {
    cuerpo = await req.json()
  } catch {
    return json({ ok: false, mensaje: 'No pudimos leer el formulario.' }, 400)
  }

  const revision = revisar(cuerpo)
  if (!revision.ok) {
    // La trampa se contesta como un éxito: ver `logica.ts`.
    if (revision.motivo === 'trampa') return json(LISTO)
    console.log(`cotizar-publico: rechazado por ${revision.motivo}`)
    return json({ ok: false, mensaje: revision.mensaje }, 400)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    // La clave de servicio: es la que saltea RLS, y la razón por la que todo
    // lo de arriba tiene que haber pasado antes de llegar acá.
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  /*
   * A qué empresa le llega. NO lo dice quien consulta.
   *
   * Si el navegador mandara el `companyId`, cualquiera podría meter consultas
   * en la bandeja de otra empresa de la base. Lo decide el mismo interruptor
   * que decide qué catálogo se publica, que es el único que puede estar
   * encendido a la vez.
   */
  const { data: empresa } = await supabase
    .from('companies')
    .select('id')
    .eq('catalogo_publico', true)
    .maybeSingle()

  if (!empresa) {
    console.error('cotizar-publico: ninguna empresa con catalogo_publico')
    return json({ ok: false, mensaje: 'No pudimos recibir la consulta.' }, 503)
  }

  /*
   * El freno de spam.
   *
   * La sal sale de un secreto del servidor. Si no está configurada no se
   * cuenta nada y se acepta igual: perder una consulta de verdad por un
   * secreto mal puesto es peor que aceptar una de más, y el aviso queda en
   * el registro para que alguien lo arregle.
   */
  const sal = Deno.env.get('COTIZAR_SAL') ?? ''
  const ip = req.headers.get('x-forwarded-for') ?? ''
  const huella = sal === '' ? null : await huellaDeOrigen(ip, sal)
  if (sal === '') console.warn('cotizar-publico: falta COTIZAR_SAL, sin freno de spam')

  if (huella !== null) {
    const desde = new Date(Date.now() - 60 * 60_000).toISOString()
    const { count } = await supabase
      .from('public_quote_requests')
      .select('id', { count: 'exact', head: true })
      .eq('origen_hash', huella)
      .gte('created_at', desde)

    if ((count ?? 0) >= MAXIMO_POR_HORA) {
      console.log('cotizar-publico: freno por repetición')
      // Se contesta que salió bien, por lo mismo que la trampa: un «te
      // frené» es información para quien está probando.
      return json(LISTO)
    }
  }

  const { pedido } = revision
  const { error } = await supabase.from('public_quote_requests').insert({
    company_id: empresa.id,
    nombre: pedido.nombre,
    email: pedido.email,
    empresa: pedido.empresa,
    telefono: pedido.telefono,
    mensaje: pedido.mensaje,
    items: pedido.items,
    cantidad_items: pedido.items.length,
    origen_hash: huella,
    // El agente recortado: sirve para distinguir un navegador de un script y
    // no hace falta entero.
    agente: (req.headers.get('user-agent') ?? '').slice(0, 200) || null,
  })

  if (error) {
    console.error('cotizar-publico: no se pudo guardar', error.message)
    return json({ ok: false, mensaje: 'No pudimos recibir la consulta. Probá de nuevo.' }, 500)
  }

  return json(LISTO)
})
