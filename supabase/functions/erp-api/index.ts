/**
 * La API del ERP por HTTP: la frontera con el mundo (Fase 67 · E1).
 *
 * Expone las herramientas del asistente como endpoints REST con su documento
 * OpenAPI. Todo lo que se puede decidir sin HTTP vive en `logica.ts`, que corre
 * en vitest; la identidad vive en `sesion.ts`, compartida con `erp-mcp`.
 *
 * ── Por qué esto es tan corto ───────────────────────────────────────────────
 *
 * Porque no hace casi nada nuevo. `../asistente/ejecutor.ts` ya es la frontera
 * de seguridad entera: corre con el JWT de la persona, pone `p_company` y
 * `p_usuario` desde el contexto, prefija los parámetros, exige los
 * obligatorios, clasifica los errores de la base en una instrucción que el
 * modelo puede seguir, y recorta la respuesta. Se usa sin tocar, así que esta
 * puerta y la de la web tienen literalmente el mismo guardia.
 *
 * ── Las tres decisiones ─────────────────────────────────────────────────────
 *
 * 1. **Va con el `verify_jwt` del gateway puesto.** Acá se puede, porque el
 *    documento OpenAPI se le pega a mano al cliente y no hace falta que sea
 *    legible sin sesión. (`erp-mcp` no puede: su protocolo exige contestar él
 *    mismo el 401. Por eso son dos funciones.)
 *
 * 2. **Sin CORS.** Los clientes de esto llaman servidor a servidor. Un
 *    `Access-Control-Allow-Origin` no habilitaría nada que haga falta y sí
 *    abriría la API a cualquier página web con el token de quien la visite.
 *
 * 3. **Nada escribe todavía.** Las trece herramientas expuestas leen.
 */
import { crearEjecutor } from '../asistente/ejecutor.ts'
import { documentoOpenAPI, elegirEmpresa, rutaDe } from './logica.ts'
import { abrirSesion, tokenDe } from './sesion.ts'

const CABECERAS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: CABECERAS })

const falla = (motivo: string, mensaje: string, status: number) =>
  json({ error: { motivo, mensaje } }, status)

/** Una línea por llamada, con el formato del resto de las funciones. */
const anotar = (datos: Record<string, unknown>) =>
  console.log(JSON.stringify({ fn: 'erp-api', ...datos }))

Deno.serve(async (req: Request): Promise<Response> => {
  const ruta = rutaDe(req.method, req.url)

  if (ruta.clase === 'desconocida') {
    return falla('ruta_desconocida', 'Esa ruta no existe.', 404)
  }
  if (ruta.clase === 'metodo') {
    return falla('metodo', 'Método equivocado para esa ruta.', 405)
  }

  /**
   * El documento, con la URL del servidor sacada de `SUPABASE_URL`.
   *
   * No del `Host` de la llamada: reflejar una cabecera que manda el cliente
   * dejaría que alguien se sirva un documento idéntico al nuestro apuntando a
   * otra parte.
   */
  if (ruta.clase === 'openapi') {
    const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
    return json(documentoOpenAPI(`${base}/functions/v1/erp-api`))
  }

  const apertura = await abrirSesion(tokenDe(req.headers.get('Authorization')))
  if (!apertura.ok) return falla(apertura.motivo, apertura.mensaje, apertura.status)
  const { token, userId, quien, correo, membresias } = apertura.sesion

  /**
   * Quién sos y con qué empresa se está trabajando.
   *
   * Existe para que la elección de empresa NUNCA sea silenciosa. Seis de las
   * siete personas tienen una sola y no se van a enterar de que esto existe;
   * la séptima tiene dos, y necesita poder ver cuál se asumió antes de creerle
   * a un total.
   */
  if (ruta.clase === 'yo') {
    const elegida = elegirEmpresa(membresias)
    return json({
      nombre: quien,
      correo,
      empresa: elegida.ok ? elegida.empresa.nombre : null,
      empresas: membresias.map((m) => ({
        nombre: m.nombre,
        rol: m.rol,
        porDefecto: elegida.ok && m.companyId === elegida.empresa.companyId,
      })),
      nota:
        membresias.length > 1
          ? 'Trabajás en más de una empresa. Para preguntar por otra, mandá «empresa» con su nombre.'
          : null,
    })
  }

  let cuerpo: Record<string, unknown>
  try {
    const crudo: unknown = await req.json()
    cuerpo = typeof crudo === 'object' && crudo !== null ? (crudo as Record<string, unknown>) : {}
  } catch {
    // Una herramienta sin parámetros obligatorios se puede llamar sin cuerpo.
    cuerpo = {}
  }

  const pedida = typeof cuerpo['empresa'] === 'string' ? cuerpo['empresa'] : undefined
  const elegida = elegirEmpresa(membresias, pedida)
  if (!elegida.ok) return falla('sin_empresa', elegida.mensaje, 403)

  /*
   * `empresa` se saca antes de pasar los argumentos: es nuestra, no de la RPC.
   * El ejecutor igual copia sólo los parámetros declarados en el esquema de la
   * herramienta, así que dejarla no haría daño; se saca para que el contrato
   * se lea de una sola manera.
   */
  const { empresa: _, ...argumentos } = cuerpo

  const ejecutar = crearEjecutor({ token, companyId: elegida.empresa.companyId, userId })

  const empezo = Date.now()
  const texto = await ejecutar(ruta.id, argumentos)
  anotar({
    herramienta: ruta.id,
    usuario: userId,
    empresa: elegida.empresa.nombre,
    ms: Date.now() - empezo,
    bytes: texto.length,
  })

  // El texto ya es JSON: el del ejecutor, con la forma que la RPC devolvió o un
  // `{"error": "..."}` que el modelo sabe leer. Se pasa tal cual.
  return new Response(texto, { status: 200, headers: CABECERAS })
})
