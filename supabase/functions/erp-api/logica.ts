/**
 * La API del ERP para ChatGPT: todo lo que se decide sin HTTP (Fase 67). PURO.
 *
 * ── Qué es esto y qué no ────────────────────────────────────────────────────
 *
 * El asistente de la web ya tiene trece herramientas sobre RPC propias y cinco
 * agentes con sus prompts. Esto NO los reescribe: los expone por HTTP para que
 * un GPT de ChatGPT los use. Allá la orquestación es gratis —el modelo de
 * OpenAI elige y encadena—, así que lo único que falta es la puerta.
 *
 * El catálogo de `../asistente/herramientas.ts` ya es la especificación:
 * nombres, descripciones y esquemas. Acá se le agrega un SEGUNDO renderizador,
 * al lado de `esquemaParaModelo()`, que lo escribe en OpenAPI. Un documento a
 * mano sería una copia de trece esquemas que se desincroniza en silencio: el
 * día que alguien agregue un parámetro a una RPC, el GPT seguiría mandando el
 * viejo y la llamada fallaría sin que nadie supiera por qué.
 *
 * Acá no hay red, ni secrets, ni base. `index.ts` es la frontera; esto corre en
 * vitest.
 */
import { agente, todosLosAgentes } from '../asistente/agentes.ts'
import { type Herramienta, HERRAMIENTAS, herramienta } from '../asistente/herramientas.ts'

/**
 * Las herramientas que ChatGPT puede ver, EN UNA LISTA EXPLÍCITA.
 *
 * No es «todo el catálogo» a propósito. El catálogo crece cuando se le agrega
 * una herramienta a un agente interno, y eso no puede publicar sola una puerta
 * nueva hacia afuera: la superficie expuesta tiene que ser una decisión que se
 * lee en un archivo y se puede auditar de un vistazo. Es el mismo criterio con
 * el que se auditó la superficie de PostgREST en la Fase 10.
 */
export const EXPUESTAS: readonly string[] = [
  // catálogo
  'buscar_productos',
  'ficha_producto',
  'resumen_catalogo',
  'stock_actual',
  // ventas
  'buscar_cliente',
  'historial_del_cliente',
  'precios_del_cliente',
  'buscar_documentos',
  'ver_documento',
  'preparar_cotizacion',
  // compras
  'ultimo_costo',
  // informes
  'ranking_comercial',
  // correo
  'buscar_emails',
]

/**
 * Las que ESCRIBEN. Hoy ninguna; `crear_cotizacion` entra acá en la E3.
 *
 * Importa porque decide si ChatGPT pide confirmación cada vez. Ver
 * `consecuente()`.
 */
const ESCRITURAS: ReadonlySet<string> = new Set<string>([])

/**
 * El parámetro que NO viene del catálogo.
 *
 * De las siete personas con acceso, seis tienen una sola empresa y una tiene
 * dos. Para esas seis el servidor resuelve solo y el GPT no tiene que saber
 * que las empresas existen; para la séptima hace falta poder decir cuál.
 *
 * Va por NOMBRE y no por id, igual que todo lo demás: un modelo al que se le
 * pide un uuid se lo inventa. Y lo que llegue se valida contra las membresías
 * de quien pregunta, así que nombrar una empresa ajena no alcanza para verla.
 */
const EMPRESA = {
  type: 'string',
  description:
    'Sólo si trabajás en más de una empresa y querés una distinta de la habitual. ' +
    'Normalmente se omite: el servidor usa la tuya. Es el nombre, como lo devuelve /yo.',
} as const

/** Lo que el servidor pone solo y el modelo no puede mandar. */
const DEL_SERVIDOR = ['company', 'usuario']

export type Ruta =
  | { clase: 'openapi' }
  | { clase: 'yo' }
  | { clase: 'herramienta'; id: string }
  | { clase: 'metodo' }
  | { clase: 'desconocida' }

/**
 * Qué pidieron.
 *
 * El path llega con el prefijo con el que Supabase sirve la función, que
 * cambia según de dónde venga la llamada (`/erp-api/...` desde el gateway,
 * `/functions/v1/erp-api/...` en algunas rutas). Se busca el nombre de la
 * función y se lee lo que viene después, en vez de contar segmentos: contar
 * segmentos es lo que se rompe el día que el prefijo cambie.
 */
export function rutaDe(metodo: string, url: string): Ruta {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    pathname = url
  }

  const partes = pathname.split('/').filter((p) => p !== '')
  const i = partes.indexOf('erp-api')
  const resto = i === -1 ? partes : partes.slice(i + 1)

  if (resto.length === 0) return { clase: 'desconocida' }

  if (resto.length === 1 && resto[0] === 'openapi.json') {
    return metodo === 'GET' ? { clase: 'openapi' } : { clase: 'metodo' }
  }

  if (resto.length === 1 && resto[0] === 'yo') {
    return metodo === 'GET' ? { clase: 'yo' } : { clase: 'metodo' }
  }

  if (resto.length === 2 && resto[0] === 'h') {
    const id = resto[1] ?? ''
    if (!EXPUESTAS.includes(id)) return { clase: 'desconocida' }
    return metodo === 'POST' ? { clase: 'herramienta', id } : { clase: 'metodo' }
  }

  return { clase: 'desconocida' }
}

/**
 * Si ChatGPT tiene que pedir confirmación antes de llamarla.
 *
 * ChatGPT da por consecuente TODO lo que no es GET, y una acción consecuente
 * pregunta cada vez, sin ofrecer «permitir siempre». Con eso, buscar un
 * producto exigiría un clic por búsqueda y nadie lo usaría.
 *
 * Y todo es POST acá —incluso las lecturas— por dos razones: los renglones de
 * una cotización son una lista, que en una query string hay que inventarle una
 * gramática; y los nombres de clientes no tienen por qué quedar escritos en
 * las URL de los logs.
 *
 * Así que se declara explícito: falso en las lecturas, verdadero en lo que
 * escribe, donde el clic es justamente lo que se quiere.
 */
function consecuente(id: string): boolean {
  return ESCRITURAS.has(id)
}

/**
 * El esquema de los argumentos de una herramienta.
 *
 * Es el MISMO para los dos consumidores: el `requestBody` de OpenAPI y el
 * `inputSchema` de MCP son el mismo objeto JSON Schema. Está exportado para
 * que `erp-mcp` lo use en vez de armarlo otra vez, que es como se
 * desincronizan.
 */
export function esquemaDeEntrada(h: Herramienta): Record<string, unknown> {
  return {
    type: 'object',
    properties: { ...h.parametros, empresa: EMPRESA },
    required: [...h.obligatorios],
    additionalProperties: false,
  }
}

function cuerpoDe(h: Herramienta): Record<string, unknown> {
  return {
    required: h.obligatorios.length > 0,
    content: { 'application/json': { schema: esquemaDeEntrada(h) } },
  }
}

/**
 * La respuesta, declarada SIN forma.
 *
 * Cada RPC devuelve su propio `jsonb` y describirlos uno por uno sería copiar
 * trece formas que nadie va a mantener. El modelo lee lo que llega; lo que
 * necesita saber de antemano es CUÁNDO llamar, y eso está en la descripción.
 */
const RESPUESTAS = {
  '200': {
    description:
      'Lo que devolvió la herramienta. Si trae la clave «error», es una instrucción ' +
      'para vos: leela y actuá, no se la muestres tal cual a la persona.',
    content: { 'application/json': { schema: { type: 'object' } } },
  },
  '401': { description: 'Falta la sesión o el token venció.' },
  '403': { description: 'Esa empresa no es tuya.' },
}

/**
 * Las herramientas que le toca a un GPT, DERIVADAS de `agentes.ts`.
 *
 * ── Por qué cada GPT lleva un esquema distinto ──────────────────────────────
 *
 * En ChatGPT las acciones de un GPT salen de UN esquema: lo que está en el
 * documento, el modelo lo puede llamar. Así que «el GPT de Ventas ve sólo lo
 * de ventas» no es una instrucción, es un documento más corto.
 *
 * Y eso es justo lo que `agentes.ts` ya resolvió: los cinco especialistas
 * existen porque uno solo eligiendo entre trece herramientas elegía mal. Acá
 * se reusa ese reparto en vez de escribir otro al lado, que es el que se
 * quedaría viejo la próxima vez que un agente gane una herramienta.
 *
 * Los `consulta` del agente se traducen en herramientas propias: donde Ventas
 * le preguntaba a Catálogo, el GPT de Ventas tiene las de Catálogo. El modelo
 * de ChatGPT hace de coordinador, así que no hace falta el intermediario.
 */
export function herramientasDelGpt(agenteId: string): readonly string[] {
  const a = agente(agenteId)
  if (!a) return []

  const juntas = [...a.herramientas]
  for (const colega of a.consulta) {
    for (const h of agente(colega)?.herramientas ?? []) juntas.push(h)
  }

  // Sin repetir, en el orden del catálogo —estable— y sólo lo que está expuesto.
  return EXPUESTAS.filter((id) => juntas.includes(id))
}

/**
 * Los GPT que se arman, uno por especialidad.
 *
 * El agente `general` queda afuera: su único trabajo es derivar, y en ChatGPT
 * eso lo hace la persona cuando elige con qué GPT habla. Igual su lista sirve
 * para otra cosa: como consulta a los cinco, `herramientasDelGpt('general')`
 * devuelve la superficie entera, que es el esquema a pegar si uno prefiere UN
 * solo GPT en vez de cinco.
 */
export function gptsAArmar(): readonly { id: string; titulo: string; herramientas: readonly string[] }[] {
  return todosLosAgentes()
    .filter((a) => a.herramientas.length > 0)
    .map((a) => ({ id: a.id, titulo: a.titulo, herramientas: herramientasDelGpt(a.id) }))
}

/**
 * El documento OpenAPI que se le pega al constructor de GPT.
 *
 * Sin `soloEstas` sale el documento entero, que es el que sirve la función en
 * `GET /openapi.json`. Con una lista, sale el de un GPT.
 */
export function documentoOpenAPI(
  servidor: string,
  soloEstas?: readonly string[],
): Record<string, unknown> {
  const paths: Record<string, unknown> = {
    '/yo': {
      get: {
        operationId: 'quien_soy',
        summary: 'Quién sos y en qué empresa estás trabajando.',
        description:
          'Devuelve tu nombre, tu correo y las empresas a las que perteneces, marcando ' +
          'cuál se usa por omisión. Llamala una sola vez al empezar si hace falta saber ' +
          'con qué empresa se está trabajando.',
        'x-openai-isConsequential': false,
        responses: RESPUESTAS,
      },
    },
  }

  const cuales = soloEstas ?? EXPUESTAS
  for (const id of EXPUESTAS.filter((e) => cuales.includes(e))) {
    const h = herramienta(id)
    if (!h) continue
    paths[`/h/${id}`] = {
      post: {
        operationId: id,
        summary: h.descripcion.split('.')[0] ?? id,
        description: h.descripcion,
        'x-openai-isConsequential': consecuente(id),
        requestBody: cuerpoDe(h),
        responses: RESPUESTAS,
      },
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'ERP BuscaTools',
      version: '1.0.0',
      description:
        'Los datos del ERP de BuscaTools: catálogo, clientes, documentos de venta, ' +
        'costos de compra, stock y bandeja de correo. Todo se lee con los permisos de ' +
        'la persona que pregunta.',
    },
    servers: [{ url: servidor }],
    components: {
      securitySchemes: {
        sesion: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ sesion: [] }],
    paths,
  }
}

export interface Membresia {
  companyId: string
  nombre: string
  rol: string
}

export type Eleccion =
  | { ok: true; empresa: Membresia; porDefecto: boolean }
  | { ok: false; mensaje: string }

/** Sin tildes y en minúsculas: «Buscatools» y «BUSCATOOLS» son la misma. */
const plano = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()

/**
 * Con qué empresa se trabaja.
 *
 * El orden es por NOMBRE, no el que devuelva la base. La pantalla elige
 * `membresias[0]` de una consulta sin `order by` y se apoya en una preferencia
 * guardada en el navegador, que acá no existe: sin un orden fijo, dos llamadas
 * seguidas podrían caer en empresas distintas y nadie entendería por qué los
 * números no coinciden.
 */
export function elegirEmpresa(ms: readonly Membresia[], pedida?: string): Eleccion {
  const ordenadas = [...ms].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  const primera = ordenadas[0]

  if (primera === undefined) {
    return { ok: false, mensaje: 'No tenés ninguna empresa activa en el ERP.' }
  }

  const buscada = pedida !== undefined ? plano(pedida) : ''
  if (buscada === '') return { ok: true, empresa: primera, porDefecto: true }

  // Primero el nombre completo; después, que empiece igual, porque un modelo
  // escribe «Buscatools» donde la razón social dice «Buscatools S.R.L.».
  const exacta = ordenadas.find((m) => plano(m.nombre) === buscada)
  const parcial = ordenadas.find((m) => plano(m.nombre).startsWith(buscada))
  const elegida = exacta ?? parcial

  if (elegida === undefined) {
    const nombres = ordenadas.map((m) => `«${m.nombre}»`).join(' o ')
    return {
      ok: false,
      mensaje: `No perteneces a ninguna empresa llamada «${pedida ?? ''}». Las tuyas son ${nombres}.`,
    }
  }
  return { ok: true, empresa: elegida, porDefecto: elegida.companyId === primera.companyId }
}

/**
 * Quién sos y con qué empresa se está trabajando.
 *
 * Lo piden las dos puertas —`GET /yo` en REST y la herramienta `quien_soy` en
 * MCP— y es la misma respuesta, así que se arma una sola vez acá. Existe para
 * que la elección de empresa NUNCA sea silenciosa: seis de las siete personas
 * tienen una sola y no se van a enterar de que esto existe, la séptima tiene
 * dos y necesita poder ver cuál se asumió antes de creerle a un total.
 */
export function perfil(datos: {
  quien: string
  correo: string | null
  membresias: readonly Membresia[]
}): Record<string, unknown> {
  const elegida = elegirEmpresa(datos.membresias)
  return {
    nombre: datos.quien,
    correo: datos.correo,
    empresa: elegida.ok ? elegida.empresa.nombre : null,
    empresas: datos.membresias.map((m) => ({
      nombre: m.nombre,
      rol: m.rol,
      porDefecto: elegida.ok && m.companyId === elegida.empresa.companyId,
    })),
    nota:
      datos.membresias.length > 1
        ? 'Trabajás en más de una empresa. Para preguntar por otra, mandá «empresa» con su nombre.'
        : null,
  }
}

/**
 * Revisa que lo expuesto sea coherente. Corre en un test, no en producción.
 *
 * Mismo criterio que `revisarRegistro()` de `agentes.ts`: los errores que
 * rompen esto no fallan al desplegar. Un id mal escrito en `EXPUESTAS` da un
 * documento con una operación de menos, y el GPT simplemente nunca puede
 * contestar sobre ese tema sin que nadie entienda por qué.
 */
export function revisarExpuestas(): string[] {
  const problemas: string[] = []
  const vistos = new Set<string>()

  for (const id of EXPUESTAS) {
    if (vistos.has(id)) problemas.push(`«${id}» está dos veces en EXPUESTAS`)
    vistos.add(id)

    const h = herramienta(id)
    if (!h) {
      problemas.push(`«${id}» no existe en el catálogo de herramientas`)
      continue
    }
    for (const fijo of h.fijos ?? []) {
      if (!DEL_SERVIDOR.includes(fijo)) problemas.push(`«${id}»: fijo desconocido «${fijo}»`)
    }
    if (Object.keys(h.parametros).includes('empresa')) {
      problemas.push(`«${id}» ya tiene un parámetro «empresa» y choca con el del servidor`)
    }
  }

  for (const id of ESCRITURAS) {
    if (!vistos.has(id)) problemas.push(`«${id}» escribe pero no está expuesta`)
  }

  // Que el catálogo no haya crecido sin que nadie decida si eso sale a ChatGPT.
  const total = HERRAMIENTAS.length
  if (total < EXPUESTAS.length) {
    problemas.push(`EXPUESTAS tiene más entradas (${EXPUESTAS.length}) que el catálogo (${total})`)
  }

  return problemas
}
