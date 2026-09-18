/**
 * Tipos del módulo de Clientes.
 *
 * La entrega 1 es de SÓLO LECTURA: acá no hay nada que describa una
 * escritura. El alta y la edición son la entrega 3.
 */

/** Una fila del listado. Las columnas son las del listado legacy. */
export interface ClienteListado {
  id: string
  /** `CLI00001`. Es la referencia del legacy, no la identidad: ésa es el uuid. */
  referencia: string | null
  razonSocial: string
  nombreComercial: string | null
  cuit: string | null
  emails: string[]
  dominios: string[]
  rubro: string | null
  telefono: string | null
  /** `true` si vino de la migración. */
  esHistorico: boolean
  necesitaRevision: boolean
  motivosRevision: string[]
  /** `deleted_at` no nulo: el cliente está dado de baja, no borrado. */
  dadoDeBaja: boolean
}

export interface PaginaDeClientes {
  filas: ClienteListado[]
  total: number
}

export type OrdenClientes = 'nombre' | 'referencia' | 'cuit' | 'rubro'
export type DireccionOrden = 'asc' | 'desc'

export interface FiltrosClientes {
  /** Búsqueda libre: nombre, nombre comercial, referencia, CUIT o email. */
  q: string
  rubro: string | null
  /** Sólo los que la migración dejó marcados. */
  soloRevision: boolean
  /** Incluir los dados de baja. Por defecto NO se ven. */
  incluirBajas: boolean
  pagina: number
  porPagina: number
  orden: OrdenClientes
  direccion: DireccionOrden
}

export const FILTROS_INICIALES: FiltrosClientes = {
  q: '',
  rubro: null,
  soloRevision: false,
  incluirBajas: false,
  pagina: 1,
  porPagina: 25,
  orden: 'nombre',
  direccion: 'asc',
}

export interface ContactoCliente {
  id: string
  nombre: string
  cargo: string | null
  email: string | null
  telefono: string | null
  fax: string | null
  esPrincipal: boolean
  notas: string | null
  /**
   * Fase 17 · E3. Un contacto que ya figura en documentos no se borra: se
   * desactiva. Deja de ofrecerse en los documentos nuevos y los viejos lo
   * siguen nombrando igual.
   */
  activo: boolean
  /** Testigo de concurrencia: el `updated_at` que se leyó. */
  actualizadoEn: string
}

export interface DireccionCliente {
  id: string
  /** `shipping` | `billing` | `both` | `other`, tal como los acepta el CHECK. */
  tipo: string
  calle: string
  ciudad: string | null
  provincia: string | null
  codigoPostal: string | null
  /** Código de dos letras: `country_code`. */
  pais: string | null
  notas: string | null
  esPrincipal: boolean
  /** La dirección en una línea, para mostrarla sin armarla en cada lugar. */
  texto: string
  /** Fase 17 · E3: igual que en los contactos, se desactiva y no se borra. */
  activo: boolean
  /** Testigo de concurrencia. */
  actualizadoEn: string
}

/**
 * Un cliente que se parece al que se está cargando (Fase 17 · E5).
 *
 * `fuerza` dice cuánto pesa la coincidencia, y con eso la pantalla decide si
 * bloquea o sólo avisa:
 *
 *   · `fuerte` — el mismo CUIT. No es un parecido: es el mismo contribuyente,
 *                y la base no va a dejar crear el segundo.
 *   · `media`  — el mismo email o el mismo teléfono. Pasa de verdad —diez
 *                grupos de clientes comparten email en producción— y no
 *                siempre es un duplicado: una casa matriz y su sucursal.
 *   · `debil`  — el nombre se parece. **Nunca** bloquea.
 */
export interface ClienteSimilar {
  id: string
  razonSocial: string
  nombreComercial: string | null
  cuit: string | null
  referencia: string | null
  emails: string[]
  telefono: string | null
  dadoDeBaja: boolean
  necesitaRevision: boolean
  motivo: 'CUIT' | 'EMAIL' | 'TELEFONO' | 'NOMBRE'
  fuerza: 'fuerte' | 'media' | 'debil'
  /** 0 a 1. Sólo significa algo para el motivo `NOMBRE`. */
  parecido: number
}

/** Una página de la cola de revisión (Fase 17 · E5). */
export interface PaginaDeRevision {
  filas: ClienteListado[]
  total: number
}

export interface AliasDeProducto {
  id: string
  /** El código con el que el cliente pide el producto, si lo usa. */
  codigoCliente: string | null
  /** El texto tal cual viene en su orden de compra. */
  descripcionCliente: string | null
  /** La forma normalizada con la que se compara. Es la clave única. */
  clave: string
  /**
   * NOT NULL en la tabla: una equivalencia sin producto no equivale a nada.
   * Es la diferencia con el legacy, que guardaba un SKU suelto en un texto.
   */
  productId: string
  sku: string | null
  nombreProducto: string | null
  marca: string | null
  /** `suggested` | `confirmed` | `rejected`, los tres del CHECK. */
  estado: string
  /** `manual` | `import` | `ai` | `legacy`. */
  origen: string | null
  vecesUsado: number
  /**
   * `true` si la confirmó una persona. Las 14 que trajo la migración están
   * en `confirmed` pero sin nadie detrás: las dio por buenas un script, no
   * alguien que mirara la orden de compra al lado del producto.
   */
  confirmadoPorPersona: boolean
  creadoEn: string
  actualizadoEn: string
}

export interface ProductoBuscado {
  id: string
  sku: string
  nombre: string
  marca: string | null
}

/** Una línea del historial de precios. Sale de un documento, no de un caché. */
export interface PrecioHistorico {
  tipo: 'cotizacion' | 'pedido'
  documentoId: string
  numero: string
  fecha: string | null
  productId: string | null
  sku: string | null
  nombre: string | null
  cantidad: number | null
  precio: number | null
  descuentoPct: number | null
  moneda: string | null
}

export interface PagRecordDePrecios {
  filas: PrecioHistorico[]
  total: number
}

/** El último precio de un producto **en una moneda**. Nunca uno global. */
export interface UltimoPrecio {
  productId: string | null
  sku: string | null
  nombre: string | null
  moneda: string | null
  ultimoPrecio: number | null
  ultimaFecha: string | null
  ultimoDocumento: string | null
  /** Fase 17 · E4: el id, para que el número sea un enlace al documento. */
  ultimoDocumentoId: string | null
  ultimoTipo: 'cotizacion' | 'pedido'
  precioAnterior: number | null
  veces: number
}

/** Los números del panel rápido. Todos salen de documentos reales. */
export interface ResumenCliente {
  cotizaciones: number
  pedidos: number
  entregas: number
  /** La fecha del documento más reciente, de cualquiera de los tres tipos. */
  ultimaActividad: string | null
  /**
   * Productos distintos cotizados o pedidos. Se cuentan por `product_id` y,
   * si la línea no lo resolvió, por su SKU.
   */
  productosDistintos: number
  documentos12m: number
}

export type TipoDeDocumento = 'cotizacion' | 'pedido' | 'entrega'

/**
 * Cuánto, por moneda **y** por tipo de documento.
 *
 * Nunca hay un total global: el panel del legacy sumaba las cuatro monedas en
 * un solo importe y ese número no significaba nada.
 */
export interface TotalPorMonedaYTipo {
  tipo: TipoDeDocumento
  /** `null` = documentos históricos que no dicen en qué moneda están. */
  moneda: string | null
  documentos: number
  importe: number
  /** Documentos contados que no tienen importe cargado. */
  sinImporte: number
}

/** Una barra del gráfico: un mes, un tipo y una moneda. */
export interface ActividadMensual {
  /** Primer día del mes, `YYYY-MM-DD`. */
  mes: string
  tipo: TipoDeDocumento
  moneda: string | null
  documentos: number
  importe: number
}

export interface CandidatoDeOc {
  id: string
  archivo: string | null
  detectadoEn: string | null
  estado: string | null
}

/** Un documento del historial del cliente. */
export interface DocumentoDeCliente {
  id: string
  tipo: TipoDeDocumento
  numero: string
  fecha: string
  estado: string
  moneda: string | null
  total: number | null
}

/** Una página del historial documental (Fase 17 · E4). */
export interface PaginaDeDocumentos {
  filas: DocumentoDeCliente[]
  /** El total ANTES de paginar, que calcula la misma consulta. */
  total: number
}

/**
 * Qué compra este cliente (Fase 17 · E4).
 *
 * Una fila por producto **y por moneda**, igual que el último precio: un
 * producto cotizado en USD y en ARS son dos respuestas y no una mezclada.
 *
 * Lo cotizado y lo pedido van SEPARADOS y nunca se suman: una cotización es
 * una pregunta y un pedido es una compra.
 */
export interface ProductoDelCliente {
  productId: string | null
  sku: string | null
  nombre: string | null
  moneda: string | null
  cotizaciones: number
  pedidos: number
  cantidadCotizada: number | null
  cantidadPedida: number | null
  ultimaFecha: string | null
  ultimoTipo: 'cotizacion' | 'pedido'
  ultimoDocumentoId: string | null
  ultimoNumero: string | null
  ultimaCantidad: number | null
  ultimoPrecio: number | null
}

export interface PaginaDeProductos {
  filas: ProductoDelCliente[]
  total: number
}

/**
 * Un evento de la trazabilidad, tal como está en `sales_audit` (Fase 17 · E4).
 *
 * Se guarda crudo y se traduce a castellano en `lib/trazabilidad.ts`: la
 * pantalla no tiene por qué saber que `is_default` quiere decir «principal».
 */
export interface EventoDeCliente {
  id: string
  accion: string
  desde: string | null
  hasta: string | null
  diff: Record<string, unknown> | null
  cuando: string
  quien: string | null
}

export interface ClienteDetalle {
  id: string
  referencia: string | null
  razonSocial: string
  nombreComercial: string | null
  nombreLegacy: string | null
  cuit: string | null
  emails: string[]
  dominios: string[]
  rubro: string | null
  telefono: string | null
  tipo: string
  estado: string
  condicionDePago: string | null
  monedaPorDefecto: string | null
  descuentoPct: number
  limiteDeCredito: number | null
  vendedor: string | null
  /** El id del vendedor: lo necesita el formulario, el nombre es para mostrar. */
  vendedorId: string | null
  tarifaId: string | null
  tarifaNombre: string | null
  notas: string | null
  esHistorico: boolean
  origenLegacy: string | null
  necesitaRevision: boolean
  motivosRevision: string[]
  dadoDeBaja: boolean
  creadoEn: string
  /** Testigo de concurrencia: se manda al guardar y el servidor lo compara. */
  actualizadoEn: string
}


/** Re-export para que las pantallas no importen del servicio. */
export type { AdjuntoCliente } from '../services/adjuntos'

// ── Fase 19 · E1: la ficha rápida ──────────────────────────────────────────

/**
 * Las claves de KPI que devuelve `resumen_cliente_360`.
 *
 * Son un tipo cerrado a propósito: si el día de mañana la función devuelve una
 * clave nueva, la pantalla no la va a mostrar sola —hay que decidir dónde va y
 * cómo se llama— y eso es mejor que una tarjeta que aparece sin que nadie la
 * haya diseñado.
 */
export type ClaveKpi =
  | 'vendido_mes'
  | 'vendido_mes_anterior'
  | 'cotizado_mes'
  | 'cotizado_mes_anterior'
  | 'cotizaciones_abiertas'
  | 'pedidos_por_entregar'

export interface ValorKpi {
  clave: ClaveKpi
  /** `null` = documentos que no dicen su moneda. Nunca se suma con otra. */
  moneda: string | null
  documentos: number
  importe: number
}

export interface ContactoRapido {
  id: string
  nombre: string
  rol: string | null
  email: string | null
  telefono: string | null
}

export interface DocumentoReciente {
  tipo: TipoDeDocumento
  id: string
  numero: string | null
  fecha: string | null
  estado: string | null
  /** Sólo en pedidos: `pending`, `partially_delivered`, `delivered`… */
  entrega: string | null
  moneda: string | null
  total: number | null
}

export interface ProductoReciente {
  productId: string | null
  sku: string | null
  nombre: string | null
  /** De dónde salió el precio: un pedido pesa más que una cotización. */
  origen: 'cotizacion' | 'pedido'
  fecha: string | null
  cantidad: number | null
  precio: number | null
  moneda: string | null
}

export interface Cliente360 {
  cliente: {
    id: string
    referencia: string | null
    razonSocial: string
    nombreComercial: string | null
    cuit: string | null
    rubro: string | null
    tipo: string | null
    estado: string | null
    dadoDeBaja: boolean
    necesitaRevision: boolean
    motivosRevision: string[]
    emails: string[]
    telefono: string | null
    esHistorico: boolean
  }
  comercial: {
    vendedorId: string | null
    vendedor: string | null
    moneda: string | null
    condicionDePago: string | null
    tarifaId: string | null
    tarifa: string | null
    contacto: ContactoRapido | null
  }
  kpis: {
    /** Primer día del mes en curso, `YYYY-MM-DD`. */
    mes: string
    mesAnterior: string
    valores: ValorKpi[]
  }
  meses: ActividadMensual[]
  recientes: DocumentoReciente[]
  productos: ProductoReciente[]
  totales: {
    cotizaciones: number
    pedidos: number
    entregas: number
    ultimaActividad: string | null
    documentos12m: number
  }
}
