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
}

export interface DireccionCliente {
  id: string
  /** `shipping` | `billing` | `both`, tal como los acepta el CHECK. */
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
  notas: string | null
  esHistorico: boolean
  origenLegacy: string | null
  necesitaRevision: boolean
  motivosRevision: string[]
  dadoDeBaja: boolean
  creadoEn: string
}

export interface RelacionadosCliente {
  direcciones: DireccionCliente[]
  candidatosDeOc: CandidatoDeOc[]
}
