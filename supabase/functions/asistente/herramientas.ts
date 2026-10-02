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

/**
 * Un esquema JSON, en la forma acotada que se usa acá.
 *
 * Hay dos formas y no una porque cotizar necesita una LISTA de renglones, y
 * pedirle al modelo que los mande en un texto —«SKU x cantidad, SKU x
 * cantidad»— es ponerle una gramática propia que va a escribir mal el día
 * menos pensado. Lo que es una lista se declara como lista.
 */
export type EsquemaParametro =
  | {
      type: 'string' | 'number' | 'integer' | 'boolean'
      description: string
      enum?: readonly string[]
    }
  | {
      type: 'array'
      description: string
      items: {
        type: 'object'
        properties: Record<string, EsquemaParametro>
        required: readonly string[]
      }
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
      /*
       * El estado lleva su lista, igual que `tipo`, y lleva la traducción.
       *
       * Era texto libre con la descripción «Estado del documento. Vacío:
       * todos.». El modelo no tenía de dónde sacar que la base dice `sent` y
       * mandaba la palabra de la pregunta —«pendiente»—, que no existe. La RPC
       * la pasa tal cual al filtro, no encuentra nada y contesta «No hay
       * cotizaciones en ese período». Probado: «¿qué cotizaciones tenemos
       * pendientes?» devolvía que no había ninguna, con 143 enviadas y 3
       * borradores en la base.
       *
       * Lo que lo arregla no es sólo la lista: es decir qué significa cada
       * una en las palabras que usa la gente acá. Sin eso el modelo tiene los
       * valores pero sigue sin saber cuál corresponde a «pendiente».
       */
      estado: {
        type: 'string',
        description:
          'Estado del documento. Vacío: todos, que suele ser lo que conviene. ' +
          'Una cotización «pendiente» o «sin respuesta» es `sent`: ya salió y el cliente todavía no la aceptó. ' +
          '`accepted` es la que el cliente aceptó. ' +
          'Los pedidos en curso son `confirmed` y las entregas hechas, `delivered`. ' +
          'Los borradores no se listan nunca.',
        enum: ['sent', 'accepted', 'confirmed', 'delivered'],
      },
      cliente: texto('Nombre del cliente. Vacío: todos.'),
      /*
       * Ordenar por importe no es un lujo: sin esto el ranking era falso.
       *
       * La herramienta devuelve como mucho 40 filas y las traía ordenadas por
       * FECHA. Pedirle «las 3 cotizaciones pendientes más grandes» sobre 143
       * le daba al modelo las 40 más recientes para que rankeara esa muestra,
       * que nadie eligió. Probado: contestó que la mayor en USD era de Mirgor
       * por 154.796,85 cuando la real era de Volkswagen por 225.783,46.
       *
       * El error no se notaba: los números que daba eran de verdad, sólo que
       * faltaba el primero. Ahora la base ordena sobre el conjunto entero.
       */
      orden: {
        type: 'string',
        description:
          'Cómo ordenar. `fecha` (por defecto) trae los más recientes. ' +
          '`importe` trae los de mayor monto, ordenando sobre TODOS los del período y no sobre la página. ' +
          'Usá `importe` siempre que te pidan «los más grandes», «el más caro» o un ranking por plata. ' +
          'Con `importe` la moneda es obligatoria.',
        enum: ['fecha', 'importe'],
      },
      /*
       * Y la moneda es obligatoria al rankear, a propósito: acá se opera en
       * USD, ARS y EUR, y un «top 3 por importe» que las mezcla ordena números
       * que no son comparables. Si falta, la base no adivina: devuelve un
       * error que explica qué pedir.
       */
      moneda: texto(
        'USD, ARS o EUR. Vacío: todas, que sólo sirve ordenando por fecha. ' +
          'Obligatoria cuando el orden es `importe`.',
      ),
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

  // ── preparar una cotización ────────────────────────────────────────────────
  {
    id: 'preparar_cotizacion',
    descripcion:
      'Arma el BORRADOR de una cotización: resuelve el cliente, busca cada producto, ' +
      'trae el precio que se le cobró a ese cliente y calcula el total. ' +
      'NO la crea: crearla es un botón que aprieta la persona. ' +
      'Usala cuando te pidan cotizar, presupuestar o «armame una cotización».',
    parametros: {
      cliente: texto('El nombre del cliente, como lo devolvió buscar_cliente.'),
      productos: {
        type: 'array',
        description: 'Los renglones de la cotización, en el orden en que los pidieron.',
        items: {
          type: 'object',
          properties: {
            producto: texto('El SKU si lo sabés, o el nombre tal como lo dijeron.'),
            cantidad: entero('Cuántas unidades. Si no lo dijeron, 1.'),
          },
          required: ['producto', 'cantidad'],
        },
      },
      moneda: texto('USD, ARS o EUR. Por defecto USD.'),
    },
    obligatorios: ['cliente', 'productos'],
    rpc: 'asistente_preparar_cotizacion',
    fijos: ['company'],
    maxFilas: 1,
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
