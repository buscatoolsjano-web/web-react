/**
 * Las herramientas que puede usar un agente (Fase 31 · E1). PURO.
 *
 * Una herramienta es una RPC de la base envuelta en un esquema que el modelo
 * puede completar. Nada acá toca la red: esto es el catálogo, y `ejecutor.ts`
 * es quien lo ejecuta.
 *
 * ── Las tres reglas que hacen que esto no invente ────────────────────────────
 *
 * 1. **El modelo nunca ve un UUID.** Ni el de la empresa, ni el del usuario.
 *    Los pone el servidor a partir del JWT, y por eso la RLS sigue mandando:
 *    un agente no puede leer nada que la persona que pregunta no pueda leer.
 *    Un modelo al que se le pide un `company_id` se lo inventa.
 *
 * 2. **Los nombres de los parámetros son los de la RPC sin el `p_`.** No hay
 *    tabla de equivalencias que mantener sincronizada: `texto` es `p_texto`.
 *    Una capa de traducción a mano es una capa donde se desincronizan las
 *    cosas en silencio.
 *
 * 3. **Toda herramienta devuelve filas legibles**, no identificadores. Es la
 *    razón por la que hay RPC nuevas en vez de reusar `search_products`, que
 *    devuelve `(id, score, rank_position, total_count)`: perfecto para la
 *    pantalla, que después pide los productos, e inútil para un modelo, que
 *    recibiría cincuenta UUID y no podría decir ni un nombre.
 */

/** Un esquema JSON, en la forma acotada que se usa acá. */
export interface EsquemaParametro {
  type: 'string' | 'number' | 'integer' | 'boolean'
  description: string
  enum?: readonly string[]
}

export interface Herramienta {
  /** El nombre que ve el modelo. En castellano: el prompt también lo está. */
  id: string
  /** CUÁNDO usarla, no qué hace. Es lo que el modelo lee para decidir. */
  descripcion: string
  parametros: Record<string, EsquemaParametro>
  obligatorios: readonly string[]
  /** La RPC de la base. Los parámetros van con el prefijo `p_`. */
  rpc: string
  /** Los que pone el SERVIDOR desde el JWT, fuera del alcance del modelo. */
  fijos?: readonly ('company' | 'usuario')[]
  /**
   * Cuántas filas se le devuelven al modelo como máximo.
   *
   * No es una optimización: es lo que evita que una herramienta con la
   * pregunta mal acotada —«listame los productos»— llene la ventana de
   * contexto y deje al agente sin lugar para razonar. Cuando se recorta, se
   * le AVISA al modelo cuántas había, para que pueda afinar la búsqueda o
   * decir que hay más.
   */
  maxFilas: number
}

const texto = (description: string): EsquemaParametro => ({ type: 'string', description })
const entero = (description: string): EsquemaParametro => ({ type: 'integer', description })

/**
 * El catálogo, indexado por id.
 *
 * Está agrupado por tema y no por agente a propósito: la misma herramienta la
 * pueden usar varios —el precio de un producto le sirve a Ventas y a
 * Compras—, y duplicarla sería duplicar el lugar donde corregirla.
 */
export const HERRAMIENTAS: readonly Herramienta[] = [
  // ── catálogo ──────────────────────────────────────────────────────────────
  {
    id: 'buscar_productos',
    descripcion:
      'Busca productos del catálogo por texto libre: nombre, SKU, marca, modelo o características. ' +
      'Devuelve SKU, nombre, marca, categoría, precio de lista y stock. ' +
      'Usala siempre antes de afirmar que un producto existe o no existe.',
    parametros: {
      texto: texto('Qué buscar. Puede ser un SKU, un nombre, una marca o una descripción.'),
      limite: entero('Cuántos traer (1 a 40). Por defecto 15.'),
    },
    obligatorios: ['texto'],
    rpc: 'asistente_buscar_productos',
    fijos: ['company'],
    maxFilas: 40,
  },
  {
    id: 'ficha_producto',
    descripcion:
      'La ficha completa de UN producto por su SKU: todos sus atributos técnicos, precio, ' +
      'stock por depósito y equivalentes. Usala cuando haga falta el detalle y no el listado.',
    parametros: { sku: texto('El SKU exacto, como lo devolvió buscar_productos.') },
    obligatorios: ['sku'],
    rpc: 'asistente_ficha_producto',
    fijos: ['company'],
    maxFilas: 1,
  },
  {
    id: 'resumen_catalogo',
    descripcion:
      'Cuántos productos hay por categoría y por marca. Usala para preguntas sobre el TAMAÑO ' +
      'o la composición del catálogo, no para buscar un producto puntual.',
    parametros: {},
    obligatorios: [],
    rpc: 'asistente_resumen_catalogo',
    fijos: ['company'],
    maxFilas: 200,
  },

  // ── clientes ──────────────────────────────────────────────────────────────
  {
    id: 'buscar_cliente',
    descripcion:
      'Encuentra un cliente por nombre, CUIT, email o teléfono. Devuelve los que se parecen. ' +
      'Si vuelve más de uno, PREGUNTÁ cuál es antes de seguir: equivocarse de cliente manda ' +
      'la mercadería a otra empresa.',
    parametros: { texto: texto('Nombre, CUIT, email o teléfono del cliente.') },
    obligatorios: ['texto'],
    rpc: 'asistente_buscar_cliente',
    fijos: ['company'],
    maxFilas: 10,
  },
  {
    id: 'historial_del_cliente',
    descripcion:
      'Los últimos documentos de un cliente (cotizaciones, pedidos, remitos, facturas) con su ' +
      'estado e importe. Sirve para «¿qué le vendimos a X?» o «¿cómo viene X?».',
    parametros: {
      cliente: texto('El nombre exacto del cliente, como lo devolvió buscar_cliente.'),
      limite: entero('Cuántos documentos traer (1 a 30). Por defecto 15.'),
    },
    obligatorios: ['cliente'],
    rpc: 'asistente_historial_cliente',
    fijos: ['company'],
    maxFilas: 30,
  },
  {
    id: 'precios_del_cliente',
    descripcion:
      'A qué precio se le vendió cada producto a un cliente, con la fecha y el documento. ' +
      'Es la herramienta para «¿a cuánto le cotizamos esto la última vez?».',
    parametros: {
      cliente: texto('El nombre exacto del cliente.'),
      producto: texto('SKU o texto del producto. Vacío: todos los productos del cliente.'),
    },
    obligatorios: ['cliente'],
    rpc: 'asistente_precios_cliente',
    fijos: ['company'],
    maxFilas: 30,
  },

  // ── ventas ────────────────────────────────────────────────────────────────
  {
    id: 'buscar_documentos',
    descripcion:
      'Busca documentos de venta o de compra por tipo, fecha, estado o cliente. ' +
      'Usala para «¿qué cotizaciones hay pendientes?» o «¿qué se facturó en agosto?».',
    parametros: {
      tipo: {
        type: 'string',
        description: 'Qué tipo de documento. Sólo documentos de VENTA.',
        enum: ['cotizacion', 'pedido', 'remito'],
      },
      desde: texto('Fecha inicial en formato AAAA-MM-DD. Por defecto, hace 30 días.'),
      hasta: texto('Fecha final en formato AAAA-MM-DD. Por defecto, hoy.'),
      estado: texto('Estado del documento. Vacío: todos.'),
      cliente: texto('Nombre del cliente. Vacío: todos.'),
      limite: entero('Cuántos traer (1 a 40). Por defecto 20.'),
    },
    obligatorios: ['tipo'],
    rpc: 'asistente_buscar_documentos',
    fijos: ['company'],
    maxFilas: 40,
  },
  {
    id: 'ver_documento',
    descripcion:
      'Un documento completo por su número (COT-00012, PED-00034…): cabecera, líneas y la ' +
      'cadena de documentos relacionados. Usala cuando la persona nombre un documento.',
    parametros: { numero: texto('El número del documento, tal cual.') },
    obligatorios: ['numero'],
    rpc: 'asistente_ver_documento',
    fijos: ['company'],
    maxFilas: 1,
  },

  // ── informes ──────────────────────────────────────────────────────────────
  {
    id: 'ranking_comercial',
    descripcion:
      'El ranking de clientes o de productos en un período, sobre lo ENTREGADO. ' +
      'Los clientes se miden por importe y hay que decir en qué moneda; los productos, ' +
      'por cantidad de unidades. Es la herramienta para «el mejor cliente de agosto».',
    parametros: {
      dimension: { type: 'string', description: 'Qué rankear.', enum: ['clientes', 'productos'] },
      mes: texto('El mes en formato AAAA-MM-01. Vacío: el mes en curso.'),
      moneda: texto('Para clientes: la moneda del ranking (USD, ARS, EUR). Por defecto USD.'),
      limite: entero('Cuántos puestos (1 a 20). Por defecto 10.'),
    },
    obligatorios: ['dimension'],
    rpc: 'asistente_ranking',
    fijos: ['company'],
    maxFilas: 20,
  },
  {
    id: 'stock_actual',
    descripcion:
      'El stock por producto y depósito: en mano, reservado y disponible. ' +
      'Usala para «¿hay stock de X?» o «¿qué está en negativo?».',
    parametros: {
      texto: texto('SKU o nombre del producto. Vacío: todo.'),
      limite: entero('Cuántas filas (1 a 40). Por defecto 20.'),
    },
    obligatorios: [],
    rpc: 'asistente_stock',
    fijos: ['company'],
    maxFilas: 40,
  },

  // ── compras ───────────────────────────────────────────────────────────────
  {
    id: 'ultimo_costo',
    descripcion:
      'A qué costo se compró un producto por última vez, con el proveedor y la fecha. ' +
      'Es distinto del precio de venta: esto es lo que NOSOTROS pagamos.',
    parametros: { sku: texto('El SKU del producto.') },
    obligatorios: ['sku'],
    rpc: 'asistente_ultimo_costo',
    fijos: ['company'],
    maxFilas: 5,
  },

  // ── emails ────────────────────────────────────────────────────────────────
  {
    id: 'buscar_emails',
    descripcion:
      'Busca en la bandeja de entrada por texto, estado o remitente. Devuelve asunto, ' +
      'remitente, fecha y a quién está asignado. Es el único que ve los correos.',
    parametros: {
      texto: texto('Qué buscar en asunto o cuerpo. Vacío: los más recientes.'),
      sin_leer: { type: 'boolean', description: 'Sólo los no leídos.' },
      limite: entero('Cuántos traer (1 a 25). Por defecto 15.'),
    },
    obligatorios: [],
    rpc: 'asistente_buscar_emails',
    fijos: ['company'],
    maxFilas: 25,
  },
]

const PORID = new Map(HERRAMIENTAS.map((h) => [h.id, h]))

export function herramienta(id: string): Herramienta | null {
  return PORID.get(id) ?? null
}

/**
 * El esquema que se le manda al proveedor, en la forma de «function calling».
 *
 * `additionalProperties: false` no es decoración: sin eso el modelo agrega
 * parámetros que la RPC no tiene, la llamada falla, y el agente se pasa el
 * resto de la conversación disculpándose por un error que no puede ver.
 */
export function esquemaParaModelo(h: Herramienta): Record<string, unknown> {
  return {
    type: 'function',
    name: h.id,
    description: h.descripcion,
    parameters: {
      type: 'object',
      properties: h.parametros,
      required: [...h.obligatorios],
      additionalProperties: false,
    },
  }
}
