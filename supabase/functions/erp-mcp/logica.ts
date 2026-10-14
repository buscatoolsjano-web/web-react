/**
 * El servidor MCP del ERP: todo lo que se decide sin HTTP (Fase 67 · E4). PURO.
 *
 * ── Por qué MCP y no las acciones de un GPT ─────────────────────────────────
 *
 * Los GPT personalizados se retiran el 11 de diciembre de 2026, y en la
 * migración a plugins **las acciones personalizadas no se transfieren**: las
 * instrucciones pasan a ser una «skill» y las acciones hay que rehacerlas. Un
 * esquema OpenAPI para un GPT era, entonces, trabajo con fecha de vencimiento.
 *
 * El reemplazo son las apps MCP, que además es lo único que permite ESCRIBIR
 * desde ChatGPT (full MCP está en Business, Enterprise y Edu; Pro sólo lee).
 *
 * Lo que no cambia es el fondo: las mismas trece RPC, el mismo ejecutor, la
 * misma RLS. MCP es otro idioma para la misma puerta, y por eso esto es tan
 * corto: traduce JSON-RPC a una llamada al ejecutor y nada más.
 *
 * ── Y por qué es una función aparte de `erp-api` ────────────────────────────
 *
 * No es por comodidad. El protocolo exige que el servidor conteste él mismo el
 * 401 con una cabecera `WWW-Authenticate` que dice dónde está su documento de
 * metadatos: así descubre el cliente a qué servidor de autorización ir. Con el
 * `verify_jwt` del gateway puesto, el 401 lo contesta el gateway y esa cabecera
 * no existe, así que el descubrimiento no arranca nunca.
 *
 * Entonces `erp-mcp` se despliega con `--no-verify-jwt` y valida el token ella
 * misma —igual que `whatsapp-webhook` y `whatsapp-ai-worker`—, mientras
 * `erp-api` conserva la protección del gateway. Separarlas deja que cada una
 * tenga la postura que su protocolo necesita en vez de bajar las dos a la más
 * débil.
 */
import { esquemaDeEntrada, EXPUESTAS } from '../erp-api/logica.ts'
import { herramienta } from '../asistente/herramientas.ts'
import { entradaDeSkill, INSTRUCCIONES, RECURSOS, SKILL_URI } from './skill.ts'

/**
 * La herramienta de perfil: quién está conectado.
 *
 * No es una RPC del catálogo, así que no sale de `herramientas.ts`: la contesta
 * `index.ts` con los datos de la sesión. Va marcada con `openai/profile`, una
 * convención de ChatGPT para identificar cuentas conectadas y que la persona
 * pueda distinguirlas cuando tiene más de una.
 *
 * Y sirve para algo más concreto: que la elección de empresa nunca sea
 * silenciosa. Seis de las siete personas tienen una sola empresa y no se van a
 * enterar; la séptima tiene dos y necesita poder ver cuál se asumió antes de
 * creerle a un total.
 */
export const PERFIL = 'quien_soy'

/**
 * El título legible de cada herramienta, para la interfaz de ChatGPT.
 *
 * Están acá y no en `herramientas.ts` porque son PRESENTACIÓN de esta
 * superficie, no parte del catálogo. Y están escritos a mano y no derivados
 * del id porque en castellano derivarlos sale mal: `resumen_catalogo` daría
 * «Resumen catalogo», sin la tilde. Un test comprueba que no falte ninguno, así
 * que esta lista no se puede quedar corta en silencio.
 */
const TITULOS: Readonly<Record<string, string>> = {
  [PERFIL]: 'Quién soy',
  buscar_productos: 'Buscar productos',
  ficha_producto: 'Ficha de un producto',
  resumen_catalogo: 'Resumen del catálogo',
  stock_actual: 'Stock actual',
  buscar_cliente: 'Buscar un cliente',
  historial_del_cliente: 'Historial de un cliente',
  precios_del_cliente: 'Precios de un cliente',
  buscar_documentos: 'Buscar documentos',
  ver_documento: 'Ver un documento',
  preparar_cotizacion: 'Preparar una cotización',
  ultimo_costo: 'Último costo de compra',
  ranking_comercial: 'Ranking comercial',
  buscar_emails: 'Buscar correos',
}

/**
 * Las versiones del protocolo que sabemos hablar, la preferida primero.
 *
 * Se le CONTESTA la que pidió el cliente cuando la conocemos, porque es lo que
 * hace que un cliente más viejo siga funcionando cuando salga la próxima. Si
 * pide una que no conocemos, se le ofrece la nuestra y él decide.
 */
export const VERSIONES = ['2026-07-28', '2025-06-18', '2025-03-26'] as const

export function versionAUsar(pedida: unknown): string {
  return typeof pedida === 'string' && (VERSIONES as readonly string[]).includes(pedida)
    ? pedida
    : VERSIONES[0]
}

/** Lo que el servidor dice que es. */
export const SERVIDOR = { name: 'erp-buscatools', version: '1.0.0' } as const

/**
 * El alcance que se pide. Uno solo y por ahora nominal.
 *
 * Los permisos de verdad no viven acá: viven en la RLS, que filtra por la
 * persona del token. Un alcance por herramienta sería una segunda lista de
 * permisos que hay que mantener de acuerdo con la primera, y cuando dos listas
 * de permisos discrepan gana la equivocada.
 */
export const ALCANCE = 'erp'

/**
 * El documento de RFC 9728 que dice quién autoriza el acceso a este servidor.
 *
 * `authorization_servers` apunta al proyecto de Supabase, que es el que emite
 * los tokens. El cliente lo lee, va a buscar los metadatos del servidor de
 * autorización y arma el flujo solo.
 *
 * No lleva `offline_access` a propósito: el spec dice que un recurso protegido
 * NO debería pedirlo, porque un refresh token no es un requisito del recurso
 * sino del cliente. Que ChatGPT pueda renovar depende de que Supabase lo
 * anuncie en SUS metadatos, no en los nuestros.
 */
export function metadatosDelRecurso(recurso: string, supabaseUrl: string): Record<string, unknown> {
  return {
    resource: recurso,
    authorization_servers: [`${supabaseUrl.replace(/\/+$/, '')}/auth/v1`],
    scopes_supported: [ALCANCE],
    bearer_methods_supported: ['header'],
  }
}

/** La cabecera que arranca el descubrimiento. Sin esto, nada funciona. */
export function desafio(urlDeMetadatos: string, alcance = ALCANCE): string {
  return `Bearer resource_metadata="${urlDeMetadatos}", scope="${alcance}"`
}

/**
 * Las herramientas, en la forma que espera MCP.
 *
 * `annotations` es el equivalente de `x-openai-isConsequential`: ChatGPT decide
 * si pide confirmación según los permisos de la app y el contexto, y
 * `readOnlyHint` es lo que le dice que una búsqueda no cambia nada. Marcarlas
 * mal significa un clic por búsqueda, o peor, una escritura sin confirmar.
 */
export function herramientasMCP(soloEstas?: readonly string[]): Record<string, unknown>[] {
  const cuales = soloEstas ?? EXPUESTAS

  const perfil = {
    name: PERFIL,
    title: TITULOS[PERFIL],
    description:
      'Quién sos y en qué empresa estás trabajando: tu nombre, tu correo y las empresas ' +
      'a las que perteneces, marcando la que se usa por omisión. Llamala una vez si hace ' +
      'falta saber con qué empresa se está trabajando.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    // La convención de ChatGPT para reconocer la cuenta conectada.
    _meta: { 'openai/profile': true },
  }

  const resto = EXPUESTAS.filter((id) => cuales.includes(id)).flatMap((id) => {
    const h = herramienta(id)
    if (!h) return []
    return [
      {
        name: id,
        title: TITULOS[id] ?? id,
        description: h.descripcion,
        inputSchema: esquemaDeEntrada(h),
        annotations: {
          // Las trece expuestas hoy LEEN. Cuando entre `crear_cotizacion`,
          // ésta es la línea que tiene que cambiar para ella y sólo para ella.
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          // No sale a internet: habla con nuestra base y nada más.
          openWorldHint: false,
        },
      },
    ]
  })

  // El perfil primero: es lo que se llama al empezar, y así queda a la vista.
  return [perfil, ...resto]
}

/* ── JSON-RPC ──────────────────────────────────────────────────────────────── */

export interface Peticion {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

export type Resuelto =
  | { clase: 'resultado'; id: unknown; resultado: Record<string, unknown> }
  | { clase: 'error'; id: unknown; codigo: number; mensaje: string }
  | { clase: 'nada' }
  | { clase: 'llamada'; id: unknown; nombre: string; argumentos: Record<string, unknown> }
  /** `quien_soy`: lo contesta `index.ts` con la sesión, sin tocar la base. */
  | { clase: 'perfil'; id: unknown }

export interface OpcionesDeResolver {
  /** Para publicar sólo algunas herramientas. Por omisión, todas las expuestas. */
  herramientas?: readonly string[] | undefined
  /**
   * El SHA-256 del SKILL.md, que `index.ts` calcula con WebCrypto.
   *
   * Sin él no se pueden contestar los métodos de skills: OpenAI verifica el
   * digest de cada recurso al importar y rechaza el import si no coincide.
   */
  digestDelMd?: string | undefined
}

/** Los códigos de JSON-RPC 2.0 que usamos. */
export const SIN_METODO = -32601
export const PARAMS_MAL = -32602
export const PETICION_MAL = -32600

/**
 * Qué hacer con una petición, sin tocar la red.
 *
 * Devuelve `llamada` cuando hay que ejecutar una herramienta —lo único que
 * necesita base— y el resultado ya armado para todo lo demás. Así el
 * despachador se prueba entero en vitest y `index.ts` sólo tiene que saber
 * ejecutar.
 *
 * Una NOTIFICACIÓN —sin `id`— no se contesta: devuelve `nada`. Contestarle a
 * una notificación es un error de protocolo que algunos clientes toleran y
 * otros no.
 */
export function resolver(p: Peticion, opciones: OpcionesDeResolver = {}): Resuelto {
  const herramientasVisibles = opciones.herramientas
  const id = p.id ?? null
  const esNotificacion = p.id === undefined || p.id === null
  const metodo = typeof p.method === 'string' ? p.method : ''

  if (metodo === '') {
    return esNotificacion
      ? { clase: 'nada' }
      : { clase: 'error', id, codigo: PETICION_MAL, mensaje: 'Falta «method».' }
  }

  // Las notificaciones del arranque se aceptan en silencio, que es lo correcto.
  if (metodo.startsWith('notifications/')) return { clase: 'nada' }

  if (metodo === 'initialize') {
    const params = (typeof p.params === 'object' && p.params !== null ? p.params : {}) as {
      protocolVersion?: unknown
    }
    return {
      clase: 'resultado',
      id,
      resultado: {
        protocolVersion: versionAUsar(params.protocolVersion),
        capabilities: {
          tools: { listChanged: false },
          /*
           * La extensión de skills, declarada donde OpenAI la lee.
           *
           * Tiene que ir bajo `capabilities.extensions` y con este nombre
           * exacto: la declaración experimental anterior ya no se reconoce.
           * Sin esto, «Scan Tools» importa las herramientas y NO la skill, en
           * silencio: las herramientas andan y el agente contesta peor, que es
           * la clase de falla que no se nota.
           */
          extensions: { 'io.modelcontextprotocol/skills': {} },
        },
        serverInfo: SERVIDOR,
        instructions: INSTRUCCIONES,
      },
    }
  }

  if (metodo === 'ping') return { clase: 'resultado', id, resultado: {} }

  if (metodo === 'tools/list') {
    return { clase: 'resultado', id, resultado: { tools: herramientasMCP(herramientasVisibles) } }
  }

  /*
   * ── Las skills ────────────────────────────────────────────────────────────
   *
   * Es una sola y entra en una página, así que no hay `nextCursor`: el cursor
   * se omite cuando no hay más, que es como el cliente sabe que terminó.
   *
   * `skills/get` devuelve la MISMA entrada completa que `skills/list`, no una
   * versión reducida: OpenAI compara el front matter del archivo contra la
   * entrada del catálogo y rechaza el import si no coinciden exactamente.
   */
  if (metodo === 'skills/list' || metodo === 'skills/get') {
    const digest = opciones.digestDelMd
    if (digest === undefined || digest === '') {
      return { clase: 'error', id, codigo: -32603, mensaje: 'No pude calcular el digest de la skill.' }
    }

    if (metodo === 'skills/list') {
      return { clase: 'resultado', id, resultado: { skills: [entradaDeSkill(digest)] } }
    }

    const params = (typeof p.params === 'object' && p.params !== null ? p.params : {}) as {
      uri?: unknown
    }
    if (params.uri !== SKILL_URI) {
      return { clase: 'error', id, codigo: PARAMS_MAL, mensaje: `No conozco la skill «${String(params.uri)}».` }
    }
    return { clase: 'resultado', id, resultado: entradaDeSkill(digest) }
  }

  if (metodo === 'resources/read') {
    const params = (typeof p.params === 'object' && p.params !== null ? p.params : {}) as {
      uri?: unknown
    }
    const uri = typeof params.uri === 'string' ? params.uri : ''
    const texto = RECURSOS[uri]
    if (texto === undefined) {
      return { clase: 'error', id, codigo: PARAMS_MAL, mensaje: `No conozco el recurso «${uri}».` }
    }
    // Exactamente UN item, y con la misma URI que se pidió.
    return {
      clase: 'resultado',
      id,
      resultado: { contents: [{ uri, mimeType: 'text/markdown', text: texto }] },
    }
  }

  if (metodo === 'tools/call') {
    const params = (typeof p.params === 'object' && p.params !== null ? p.params : {}) as {
      name?: unknown
      arguments?: unknown
    }
    const nombre = typeof params.name === 'string' ? params.name : ''
    const visibles = herramientasVisibles ?? EXPUESTAS

    // El perfil no es una RPC: lo contesta `index.ts` con la sesión.
    if (nombre === PERFIL) return { clase: 'perfil', id }

    if (nombre === '' || !visibles.includes(nombre)) {
      return {
        clase: 'error',
        id,
        codigo: PARAMS_MAL,
        mensaje: `No existe la herramienta «${nombre}».`,
      }
    }
    const argumentos =
      typeof params.arguments === 'object' && params.arguments !== null
        ? (params.arguments as Record<string, unknown>)
        : {}
    return { clase: 'llamada', id, nombre, argumentos }
  }

  return esNotificacion
    ? { clase: 'nada' }
    : { clase: 'error', id, codigo: SIN_METODO, mensaje: `No conozco el método «${metodo}».` }
}

/** La respuesta de una herramienta, en la forma que espera MCP. */
export function respuestaDeHerramienta(id: unknown, texto: string): Record<string, unknown> {
  /*
   * `isError` se marca cuando el ejecutor devolvió un problema.
   *
   * No es cosmético: con `isError` el cliente sabe que el modelo tiene que
   * leer el texto y reaccionar, en vez de pasárselo a la persona como si
   * fueran datos. El ejecutor ya devuelve `{"error": "..."}` con una
   * instrucción adentro, así que acá sólo hay que no perderla.
   */
  let esError = false
  try {
    const d: unknown = JSON.parse(texto)
    esError = typeof d === 'object' && d !== null && 'error' in d
  } catch {
    esError = false
  }

  return {
    jsonrpc: '2.0',
    id,
    result: { content: [{ type: 'text', text: texto }], isError: esError },
  }
}

export const sobre = (id: unknown, resultado: Record<string, unknown>) => ({
  jsonrpc: '2.0',
  id,
  result: resultado,
})

export const sobreError = (id: unknown, codigo: number, mensaje: string) => ({
  jsonrpc: '2.0',
  id,
  error: { code: codigo, message: mensaje },
})
