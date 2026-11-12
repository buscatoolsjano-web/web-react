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
const booleano = (description: string): EsquemaParametro => ({ type: 'boolean', description })
const numero = (description: string): EsquemaParametro => ({ type: 'number', description })

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
      solo_con_stock: booleano(
        'Poné true cuando la persona pide EXPLÍCITAMENTE con stock / disponible / que haya / que tengamos: ' +
          'devuelve sólo los que tienen disponible mayor a cero y descarta los demás.',
      ),
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
      'Busca documentos de venta o de compra por tipo, fecha, estado y cliente o proveedor. ' +
      'Usala para «¿qué cotizaciones hay pendientes?», «¿qué se facturó en agosto?» o ' +
      '«¿qué pedidos a TECNA hay abiertos?».',
    parametros: {
      tipo: {
        type: 'string',
        description:
          'Qué tipo de documento. Venta: cotizacion, pedido, remito (nota de entrega), factura. ' +
          'Compra: pedido_compra (pedido a proveedor), recepcion (nota de entrega de proveedor), ' +
          'factura_proveedor.',
        enum: ['cotizacion', 'pedido', 'remito', 'factura', 'pedido_compra', 'recepcion', 'factura_proveedor'],
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
          'En cotización, pedido y remito los borradores no se listan. ' +
          'Factura: `draft`, `issued` (emitida) o `paid` (cobrada). ' +
          'Pedido a proveedor: `draft` (borrador), `confirmed` (enviado), `pending` (sin recibir), `received` (recibido). ' +
          'Factura de proveedor: `draft` o `registered`.',
        enum: ['sent', 'accepted', 'confirmed', 'delivered', 'draft', 'issued', 'paid', 'pending', 'received', 'registered'],
      },
      cliente: texto('Nombre del cliente (o del PROVEEDOR en los documentos de compra). Vacío: todos.'),
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
            // Fase 243: el precio de una oferta o un Excel pisa el de lista y
            // el último del cliente. Sin precio, se resuelve como siempre.
            precio_unitario: numero(
              'Opcional. El precio unitario NETO (sin IVA) en la moneda de la cotización, si te lo ' +
                'dieron (de un Excel, de una oferta). Pisa el de lista y el último cobrado al cliente.',
            ),
            descuento: numero('Opcional. Descuento del renglón en por ciento (0 a 100).'),
          },
          required: ['producto', 'cantidad'],
        },
      },
      moneda: texto('USD, ARS o EUR. Por defecto, la de la lista de precios de la empresa.'),
    },
    obligatorios: ['cliente', 'productos'],
    rpc: 'asistente_preparar_cotizacion',
    fijos: ['company'],
    maxFilas: 1,
  },
  {
    /*
     * ── LA ÚNICA QUE ESCRIBE (Fase 67 · E3) ───────────────────────────────
     *
     * No la tiene ningún agente de `agentes.ts`, y eso es a propósito: el
     * asistente de la web no necesita crear nada, porque ahí la persona tiene
     * el botón. Esta existe para las puertas de afuera, donde no hay botón.
     *
     * Recibe LO MISMO que `preparar_cotizacion` —un nombre y una lista de
     * «producto, cantidad»— y la RPC vuelve a resolver el borrador del lado
     * del servidor. El modelo nunca manda un identificador, ni un precio, ni
     * un total: no puede alterar lo que se va a crear aunque quiera.
     */
    id: 'crear_cotizacion',
    descripcion:
      'CREA la cotización de verdad en el ERP y devuelve su número. ' +
      'Usala sólo cuando la persona ya vio el borrador de preparar_cotizacion y pidió crearla. ' +
      'Resuelve el borrador de nuevo en el servidor, así que mandale los MISMOS argumentos ' +
      'que le pasaste a preparar_cotizacion. Si algún renglón no se puede resolver no crea ' +
      'nada y te dice cuál. Si la acabás de crear, no crea una segunda: devuelve la que ya existe. ' +
      'Queda Pendiente: abierta y editable, NO se le envía a nadie. Con referencia_externa no se duplica: si ya hay una ' +
      'cotización con esa referencia, devuelve ésa.',
    parametros: {
      cliente: texto('El nombre del cliente, el mismo que usaste en preparar_cotizacion.'),
      productos: {
        type: 'array',
        description: 'Los mismos renglones que le pasaste a preparar_cotizacion.',
        items: {
          type: 'object',
          properties: {
            producto: texto('El SKU si lo sabés, o el nombre tal como lo dijeron.'),
            cantidad: entero('Cuántas unidades. Si no lo dijeron, 1.'),
            // Fase 243: el precio de una oferta o un Excel pisa el de lista y
            // el último del cliente. Sin precio, se resuelve como siempre.
            precio_unitario: numero(
              'Opcional. El precio unitario NETO (sin IVA) en la moneda de la cotización, si te lo ' +
                'dieron (de un Excel, de una oferta). Pisa el de lista y el último cobrado al cliente.',
            ),
            descuento: numero('Opcional. Descuento del renglón en por ciento (0 a 100).'),
          },
          required: ['producto', 'cantidad'],
        },
      },
      moneda: texto('USD, ARS o EUR. Por defecto, la de la lista de precios de la empresa.'),
      referencia_externa: texto(
        'Opcional. El número del mismo documento en otro sistema, p. ej. «STEL COV00748». ' +
          'Evita crearla dos veces y que la sincronización con STEL la vuelva a importar.',
      ),
      titulo: texto('Opcional. El título de la cotización. Por defecto «Cotización para <cliente>».'),
    },
    obligatorios: ['cliente', 'productos'],
    rpc: 'asistente_crear_cotizacion',
    fijos: ['company'],
    maxFilas: 1,
  },

  {
    /*
     * ── ALTA DE PRODUCTO (Fase 243) ─────────────────────────────────────────
     *
     * Para cotizar algo que todavía no está en el catálogo (un renglón de un
     * Excel de cliente). Busca el SKU antes —sin distinguir mayúsculas, aun
     * dados de baja— y si existe NO crea otro. Nace en el rubro «Pendiente de
     * clasificación» y marcado para revisar, igual que lo que crea la sync.
     * La empresa es OBLIGATORIA en las puertas de afuera (ver
     * `EMPRESA_OBLIGATORIA`): un producto creado en la empresa equivocada es
     * difícil de ver y de deshacer.
     */
    id: 'crear_producto',
    descripcion:
      'CREA un producto en el catálogo: SKU, nombre, marca y precio de lista. Usala sólo cuando un ' +
      'renglón de una cotización no existe (preparar_cotizacion no lo encontró) y la persona ' +
      'confirmó que hay que darlo de alta. Antes busca el SKU: si ya existe, no crea otro y te lo ' +
      'dice. Hay que indicar SIEMPRE la empresa.',
    parametros: {
      sku: texto('El SKU / código del producto, tal cual.'),
      nombre: texto('El nombre o descripción del producto.'),
      marca: texto('Opcional. La marca (p. ej. NORBAR).'),
      precio_lista: numero('Opcional. El precio de lista de VENTA, sin IVA, en la moneda de la lista de la empresa.'),
      moneda: texto('Opcional. La moneda del precio (EUR, USD, ARS); tiene que ser la de la lista de la empresa.'),
    },
    obligatorios: ['sku', 'nombre'],
    rpc: 'asistente_crear_producto',
    fijos: ['company'],
    maxFilas: 1,
  },

  // ── Fase 244: todo lo que se hace desde las pantallas ───────────────────────
  /*
   * Cada una es una función `asistente_*` de la base que recibe NÚMEROS, SKU y
   * nombres —nunca un uuid— y llama a la MISMA función que usa la pantalla. Los
   * errores vuelven como {"error": "..."} en castellano y nada queda a medias.
   */
  {
    id: 'editar_cotizacion',
    descripcion:
      'MODIFICA una cotización Pendiente: cambia cantidades, precios o descuentos, agrega o quita ' +
      'renglones, y el título, las notas, la condición de pago, la validez o el descuento general. ' +
      'Con modo «actualizar» (por omisión) cambia los renglones que nombrás por SKU y agrega los que no ' +
      'estén; «agregar» suma renglones; «quitar» saca los SKU que nombrás; «reemplazar» deja SÓLO los ' +
      'que mandás. Una cotización aceptada o rechazada no se modifica.',
    parametros: {
      numero: texto('El número de la cotización (COT…), o su referencia externa.'),
      productos: {
        type: 'array',
        description: 'Los renglones a cambiar, agregar o quitar.',
        items: {
          type: 'object',
          properties: {
            producto: texto('El SKU.'),
            cantidad: numero('Opcional. La cantidad.'),
            precio_unitario: numero('Opcional. El precio unitario neto (sin IVA).'),
            descuento: numero('Opcional. Descuento del renglón en por ciento.'),
          },
          required: ['producto'],
        },
      },
      modo: { type: 'string', description: 'actualizar (por omisión), agregar, quitar o reemplazar.', enum: ['actualizar', 'agregar', 'quitar', 'reemplazar'] },
      titulo: texto('Opcional. El título nuevo.'),
      notas: texto('Opcional. Las notas nuevas.'),
      condicion_pago: texto('Opcional. La condición de pago.'),
      validez: texto('Opcional. Válida hasta, AAAA-MM-DD.'),
      descuento_general: numero('Opcional. Descuento general del documento, en por ciento.'),
    },
    obligatorios: ['numero'],
    rpc: 'asistente_editar_cotizacion',
    fijos: ['company'],
    maxFilas: 1,
  },
  {
    id: 'cambiar_estado',
    descripcion:
      'CAMBIA el estado de un documento por su número. Cotización: pendiente, aceptada o rechazada. ' +
      'Pedido de venta: confirmado o cancelado. Pedido a proveedor: confirmado (= enviado al ' +
      'proveedor) o cancelado. Un pedido con entregas o recepciones no se cancela.',
    parametros: {
      numero: texto('El número del documento (COT…, PDV…, PC…).'),
      estado: texto('El estado nuevo, en castellano: pendiente, aceptada, rechazada, confirmado, cancelado.'),
    },
    obligatorios: ['numero', 'estado'],
    rpc: 'asistente_cambiar_estado',
    fijos: ['company'],
    maxFilas: 1,
  },
  {
    id: 'convertir_a_pedido',
    descripcion:
      'CONVIERTE una cotización en pedido de venta (la cotización queda aceptada). Por omisión el ' +
      'pedido queda confirmado, listo para entregar. Si la numeración de pedidos la lleva STEL, no se puede.',
    parametros: {
      numero: texto('El número de la cotización.'),
      confirmar: booleano('Opcional. false deja el pedido en borrador. Por omisión, true.'),
    },
    obligatorios: ['numero'],
    rpc: 'asistente_convertir_a_pedido',
    fijos: ['company'],
    maxFilas: 1,
  },
  {
    id: 'crear_entrega',
    descripcion:
      'CREA una nota de entrega (remito) desde un pedido de venta confirmado. Sin productos, entrega ' +
      'TODO lo pendiente; con productos, sólo esos y esas cantidades (nunca más de lo pendiente). ' +
      'Con confirmar=true descuenta el stock en el acto; si no, queda en borrador.',
    parametros: {
      numero_pedido: texto('El número del pedido de venta (PDV…).'),
      productos: {
        type: 'array',
        description: 'Opcional. Qué entregar; sin esto, todo lo pendiente.',
        items: {
          type: 'object',
          properties: { producto: texto('El SKU.'), cantidad: numero('Cuántas.') },
          required: ['producto', 'cantidad'],
        },
      },
      confirmar: booleano('Opcional. true confirma la entrega y descuenta el stock. Por omisión, false.'),
    },
    obligatorios: ['numero_pedido'],
    rpc: 'asistente_crear_entrega',
    fijos: ['company'],
    maxFilas: 1,
  },
  {
    id: 'crear_factura',
    descripcion:
      'CREA la factura de un pedido de venta (una por pedido), en borrador y con número interno: el ' +
      'número fiscal lo da AFIP al emitirla.',
    parametros: {
      numero_pedido: texto('El número del pedido de venta.'),
      fecha: texto('Opcional. AAAA-MM-DD; por omisión, hoy.'),
    },
    obligatorios: ['numero_pedido'],
    rpc: 'asistente_crear_factura',
    fijos: ['company'],
    maxFilas: 1,
  },
  {
    id: 'crear_cliente',
    descripcion:
      'CREA un cliente, con un contacto y una dirección opcionales. Si ya existe (mismo CUIT o razón ' +
      'social) no crea otro y te lo dice. Hay que indicar SIEMPRE la empresa.',
    parametros: {
      razon_social: texto('La razón social.'),
      nombre_comercial: texto('Opcional.'),
      cuit: texto('Opcional. CUIT / NIF.'),
      email: texto('Opcional. El correo del cliente.'),
      telefono: texto('Opcional.'),
      condicion_pago: texto('Opcional.'),
      moneda: texto('Opcional. Moneda habitual: ARS, USD, EUR.'),
      contacto_nombre: texto('Opcional. Nombre de la persona de contacto.'),
      contacto_email: texto('Opcional.'),
      contacto_telefono: texto('Opcional.'),
      contacto_cargo: texto('Opcional.'),
      calle: texto('Opcional. Calle y número.'),
      ciudad: texto('Opcional.'),
      provincia: texto('Opcional.'),
      codigo_postal: texto('Opcional.'),
      pais: texto('Opcional. Dos letras (AR, ES…); por omisión, el de la empresa.'),
    },
    obligatorios: ['razon_social'],
    rpc: 'asistente_crear_cliente',
    fijos: ['company'],
    maxFilas: 1,
  },
  {
    id: 'editar_cliente',
    descripcion:
      'MODIFICA un cliente: razón social, nombre comercial, CUIT, teléfono, condición de pago, moneda o ' +
      'notas. Un email se AGREGA a los que ya tiene.',
    parametros: {
      cliente: texto('El cliente, como lo devolvió buscar_cliente.'),
      razon_social: texto('Opcional.'),
      nombre_comercial: texto('Opcional.'),
      cuit: texto('Opcional.'),
      email: texto('Opcional. Se agrega a los que tiene.'),
      telefono: texto('Opcional.'),
      condicion_pago: texto('Opcional.'),
      moneda: texto('Opcional.'),
      notas: texto('Opcional.'),
    },
    obligatorios: ['cliente'],
    rpc: 'asistente_editar_cliente',
    fijos: ['company'],
    maxFilas: 1,
  },
  {
    id: 'crear_pedido_compra',
    descripcion:
      'CREA un pedido a proveedor en borrador. Con para_venta (una COT… o PDV…) cada renglón queda ' +
      'vinculado a esa venta, y lo que se compre de más queda para stock. Para mandarlo, después ' +
      'cambiar_estado a confirmado. Hay que indicar SIEMPRE la empresa.',
    parametros: {
      proveedor: texto('El proveedor, por su nombre.'),
      productos: {
        type: 'array',
        description: 'Los renglones.',
        items: {
          type: 'object',
          properties: {
            producto: texto('El SKU.'),
            cantidad: numero('Cuántas.'),
            precio_unitario: numero('Opcional. El precio de COMPRA neto.'),
            descuento: numero('Opcional. Descuento en por ciento.'),
          },
          required: ['producto', 'cantidad'],
        },
      },
      moneda: texto('Opcional. Por omisión, la del proveedor.'),
      fecha_estimada: texto('Opcional. Llegada estimada, AAAA-MM-DD.'),
      condicion_pago: texto('Opcional.'),
      notas: texto('Opcional.'),
      para_venta: texto('Opcional. La cotización o el pedido de venta para el que se compra.'),
    },
    obligatorios: ['proveedor', 'productos'],
    rpc: 'asistente_crear_pedido_compra',
    fijos: ['company'],
    maxFilas: 1,
  },
  {
    id: 'registrar_recepcion',
    descripcion:
      'REGISTRA la llegada de mercadería de un pedido a proveedor confirmado. Sin productos, recibe ' +
      'todo lo pendiente. Por omisión la confirma y el stock entra en el acto.',
    parametros: {
      numero_pedido: texto('El número del pedido a proveedor (PC…).'),
      productos: {
        type: 'array',
        description: 'Opcional. Qué llegó; sin esto, todo lo pendiente.',
        items: {
          type: 'object',
          properties: { producto: texto('El SKU.'), cantidad: numero('Cuántas llegaron.') },
          required: ['producto', 'cantidad'],
        },
      },
      remito_proveedor: texto('Opcional. El número del remito del proveedor.'),
      confirmar: booleano('Opcional. false la deja en borrador (sin mover stock). Por omisión, true.'),
    },
    obligatorios: ['numero_pedido'],
    rpc: 'asistente_registrar_recepcion',
    fijos: ['company'],
    maxFilas: 1,
  },
  {
    id: 'registrar_factura_proveedor',
    descripcion:
      'CARGA la factura de un proveedor por lo RECIBIDO y no facturado de un pedido a proveedor, con ' +
      'los precios del pedido. Por omisión queda en borrador para revisarla; registrar=true la registra.',
    parametros: {
      numero_pedido: texto('El número del pedido a proveedor (PC…).'),
      numero_proveedor: texto('El número de la factura del proveedor (p. ej. A-0001-00001234).'),
      fecha: texto('Opcional. AAAA-MM-DD; por omisión, hoy.'),
      vencimiento: texto('Opcional. AAAA-MM-DD.'),
      registrar: booleano('Opcional. true la registra. Por omisión, false (borrador).'),
    },
    obligatorios: ['numero_pedido', 'numero_proveedor'],
    rpc: 'asistente_registrar_factura_proveedor',
    fijos: ['company'],
    maxFilas: 1,
  },
  {
    id: 'actualizar_producto',
    descripcion:
      'CAMBIA el precio de lista, el costo o el nombre de un producto por su SKU. Un producto que ' +
      'maneja STEL no cambia precio ni costo acá (la sincronización lo pisaría). Hay que indicar SIEMPRE la empresa.',
    parametros: {
      sku: texto('El SKU exacto.'),
      precio_lista: numero('Opcional. Precio de lista de VENTA, sin IVA, en la moneda de la lista.'),
      costo: numero('Opcional. El costo.'),
      moneda_costo: texto('Opcional. La moneda del costo.'),
      nombre: texto('Opcional. El nombre nuevo.'),
    },
    obligatorios: ['sku'],
    rpc: 'asistente_actualizar_producto',
    fijos: ['company'],
    maxFilas: 1,
  },
  {
    id: 'ajustar_stock',
    descripcion:
      'AJUSTA el stock de un producto (por un conteo, una rotura, un error). Decí stock_final —cuántos ' +
      'tiene que haber— o diferencia (+/-), y SIEMPRE el motivo, que queda en el historial. Hay que indicar SIEMPRE la empresa.',
    parametros: {
      sku: texto('El SKU exacto.'),
      motivo: texto('Por qué se ajusta.'),
      stock_final: numero('Opcional. Cuántos tiene que haber después del ajuste.'),
      diferencia: numero('Opcional. Cuánto sumar (+) o restar (-).'),
    },
    obligatorios: ['sku', 'motivo'],
    rpc: 'asistente_ajustar_stock',
    fijos: ['company'],
    maxFilas: 1,
  },
  {
    id: 'enviar_documento',
    descripcion:
      'MANDA por correo una cotización, un pedido, una factura o un pedido a proveedor, desde la cuenta ' +
      'de Gmail de la empresa, con el detalle del documento (renglones y totales) en el cuerpo. Sin ' +
      '«para», va al correo del cliente o del proveedor. Mostrale a la persona a quién va y pedí ' +
      'confirmación antes: un correo mandado no se puede deshacer.',
    parametros: {
      numero: texto('El número del documento.'),
      para: texto('Opcional. Destinatarios separados por coma; por omisión, el correo del cliente/proveedor.'),
      asunto: texto('Opcional. Por omisión, «Cotización COT…».'),
      mensaje: texto('Opcional. El texto que va antes del detalle.'),
    },
    obligatorios: ['numero'],
    rpc: 'asistente_preparar_envio',
    fijos: ['company'],
    maxFilas: 1,
  },

  {
    id: 'enviar_whatsapp',
    descripcion:
      'MANDA un WhatsApp desde el número de la empresa a un cliente o contacto que ya tiene una ' +
      'conversación en el ERP (por su teléfono, su nombre de cliente o el nombre con el que aparece). ' +
      'WhatsApp sólo deja mandar texto libre si esa persona escribió en las últimas 24 h; si no, la ' +
      'herramienta lo dice. Mostrale a la persona a quién va y qué dice, y pedí confirmación antes.',
    parametros: {
      destino: texto('A quién: el cliente, el teléfono o el nombre del contacto.'),
      texto: texto('El mensaje, tal cual va a salir.'),
    },
    obligatorios: ['destino', 'texto'],
    rpc: 'asistente_preparar_whatsapp',
    fijos: ['company'],
    maxFilas: 1,
  },

  // ── Fase 248: fotos de producto, en masa ────────────────────────────────────
  {
    id: 'ver_fotos_producto',
    descripcion:
      'Las fotos de un producto, en orden y numeradas: la 1 es la principal (la del catálogo, los ' +
      'documentos y la web). Usala antes de elegir la principal o de quitar una.',
    parametros: { sku: texto('El SKU del producto.') },
    obligatorios: ['sku'],
    rpc: 'asistente_ver_fotos',
    fijos: ['company'],
    maxFilas: 1,
  },
  {
    id: 'agregar_fotos',
    descripcion:
      'AGREGA fotos a productos desde una URL de imagen pública (JPG, PNG o WebP, hasta 5 MB). ' +
      'Sirve para cargar en masa: hasta 40 por llamada, cada una con su SKU. Con principal=true la ' +
      'foto queda primera y como principal; si no, se agrega al final. La misma URL para varios ' +
      'productos se sube una sola vez, y si un producto ya tiene esa foto no se repite. Hay que ' +
      'indicar SIEMPRE la empresa. La URL tiene que ser la de la IMAGEN (termina en .jpg/.png/.webp ' +
      'o devuelve una imagen), no la de una página.',
    parametros: {
      fotos: {
        type: 'array',
        description: 'Las fotos a cargar (hasta 40).',
        items: {
          type: 'object',
          properties: {
            producto: texto('El SKU exacto.'),
            url: texto('La URL directa de la imagen.'),
            principal: booleano('Opcional. true la deja como foto principal. Por omisión, false.'),
          },
          required: ['producto', 'url'],
        },
      },
    },
    obligatorios: ['fotos'],
    rpc: 'asistente_preparar_fotos',
    fijos: ['company'],
    maxFilas: 1,
  },
  {
    id: 'foto_principal',
    descripcion:
      'Hace PRINCIPAL la foto número N de un producto (la numeración es la de ver_fotos_producto). ' +
      'Hay que indicar SIEMPRE la empresa.',
    parametros: {
      sku: texto('El SKU del producto.'),
      numero: entero('El número de la foto, según ver_fotos_producto.'),
    },
    obligatorios: ['sku', 'numero'],
    rpc: 'asistente_foto_principal',
    fijos: ['company'],
    maxFilas: 1,
  },
  {
    id: 'quitar_foto_producto',
    descripcion:
      'QUITA la foto número N de un producto (la numeración es la de ver_fotos_producto). Si era la ' +
      'principal, pasa a serlo la siguiente. Hay que indicar SIEMPRE la empresa.',
    parametros: {
      sku: texto('El SKU del producto.'),
      numero: entero('El número de la foto, según ver_fotos_producto.'),
    },
    obligatorios: ['sku', 'numero'],
    rpc: 'asistente_quitar_foto',
    fijos: ['company'],
    maxFilas: 1,
  },

  // ── compras ───────────────────────────────────────────────────────────────
  {
    id: 'buscar_proveedor',
    descripcion:
      'Busca un proveedor por nombre, CUIT o referencia. Devuelve sus datos, la moneda y la ' +
      'condición de pago, y cuántos pedidos tiene abiertos. Usala antes de crear_pedido_compra ' +
      'si no sabés cómo se llama exactamente.',
    parametros: { texto: texto('Nombre, CUIT o referencia del proveedor.') },
    obligatorios: ['texto'],
    rpc: 'asistente_buscar_proveedor',
    fijos: ['company'],
    maxFilas: 15,
  },
  {
    id: 'pendientes',
    descripcion:
      'Lo PENDIENTE, por producto, como las pantallas «Pendiente de entregar» y «Pendiente de ' +
      'recibir». «entregar»: lo vendido en pedidos que falta entregar, con el stock, lo que viene ' +
      'en camino y lo que falta pedir. «recibir»: lo pedido a proveedores que no llegó, cuánto es ' +
      'para ventas y cuánto para stock, y cuándo llega. Cuenta desde que el pedido se genera, ' +
      'aunque esté en borrador.',
    parametros: {
      cual: {
        type: 'string',
        description: '«entregar» (ventas) o «recibir» (compras).',
        enum: ['entregar', 'recibir'],
      },
      texto: texto('Opcional. Filtra por SKU o nombre del producto.'),
      limite: entero('Cuántos productos traer (1 a 50). Por defecto 20.'),
    },
    obligatorios: ['cual'],
    rpc: 'asistente_pendientes',
    fijos: ['company'],
    maxFilas: 50,
  },
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
