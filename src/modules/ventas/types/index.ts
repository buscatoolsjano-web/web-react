/** Los tres documentos del circuito que se migran en la Fase 4 · Stage 3. */
export type TipoDocumento = 'cotizacion' | 'pedido' | 'entrega'

/** Ruta de cada tipo, en un solo lugar. */
export const RUTA_DE: Record<TipoDocumento, string> = {
  cotizacion: '/ventas/cotizaciones',
  pedido: '/ventas/pedidos',
  entrega: '/ventas/entregas',
}

export const ETIQUETA_DE: Record<TipoDocumento, { singular: string; plural: string }> = {
  cotizacion: { singular: 'cotización', plural: 'cotizaciones' },
  pedido: { singular: 'pedido', plural: 'pedidos' },
  entrega: { singular: 'entrega', plural: 'entregas' },
}

/**
 * Una fila del listado.
 *
 * Es la MISMA forma para los tres documentos: en el legacy los tres listados
 * son literalmente el mismo listado con otra fuente, y no hay razón para
 * tener tres tipos que se diferencian en el nombre de la fecha.
 */
export interface DocumentoListado {
  id: string
  tipo: TipoDocumento
  /** El número tal como se muestra. Para el histórico es el original literal. */
  numero: string
  fecha: string
  clienteId: string | null
  clienteNombre: string
  titulo: string | null
  moneda: string | null
  total: number | null
  /** Estado crudo del backend; `estados.ts` lo traduce a etiqueta y color. */
  estado: string
  /** Segundo estado, sólo en pedidos: el de cumplimiento. */
  estadoSecundario: string | null
  vendedor: string | null
  serie: string | null
  /** Documento del que salió: la cotización de un pedido, el pedido de una entrega. */
  origen: string | null
  necesitaRevision: boolean
  motivosRevision: string[]
  numeroFueraDeSerie: boolean
  /** `true` si vino de la migración del legacy. */
  esHistorico: boolean
}

export interface PaginaDeDocumentos {
  filas: DocumentoListado[]
  total: number
}

export type OrdenVentas = 'fecha' | 'numero' | 'cliente' | 'total'
export type DireccionOrden = 'asc' | 'desc'

export interface FiltrosVentas {
  /** Búsqueda por número de documento. */
  q: string
  clienteId: string | null
  estado: string | null
  moneda: string | null
  /** ISO `YYYY-MM-DD`. */
  desde: string | null
  hasta: string | null
  /** Sólo los que quedaron marcados para revisión en la migración. */
  soloRevision: boolean
  pagina: number
  porPagina: number
  orden: OrdenVentas
  direccion: DireccionOrden
}

export const FILTROS_INICIALES: FiltrosVentas = {
  q: '',
  clienteId: null,
  estado: null,
  moneda: null,
  desde: null,
  hasta: null,
  soloRevision: false,
  pagina: 1,
  porPagina: 25,
  orden: 'fecha',
  direccion: 'desc',
}

// ── Detalle ────────────────────────────────────────────────────────────────

export interface LineaDocumento {
  id: string
  numeroLinea: number | null
  tipoLinea: 'item' | 'service' | 'chapter'
  productId: string | null
  sku: string | null
  nombre: string | null
  descripcion: string | null
  cantidad: number
  /** `null` en las 600 líneas de entrega históricas: el legacy no lo guardó. */
  precioUnitario: number | null
  descuentoPct: number | null
  tratamientoImpuesto: string | null
  tasaImpuesto: number | null
  /** Sólo en líneas de entrega: a qué línea de pedido corresponde. */
  ordenLineaId: string | null
}

export interface DocumentoDetalle {
  id: string
  tipo: TipoDocumento
  numero: string
  numeroOriginal: string | null
  numeroSospechado: string | null
  fecha: string
  clienteId: string | null
  clienteNombre: string
  contactoNombre: string | null
  titulo: string | null
  moneda: string | null
  tipoCambio: number | null
  estado: string
  estadoSecundario: string | null
  vendedor: string | null
  serie: string | null
  notas: string | null
  subtotal: number | null
  impuesto: number | null
  total: number | null
  necesitaRevision: boolean
  motivosRevision: string[]
  numeroFueraDeSerie: boolean
  esHistorico: boolean
  lineas: LineaDocumento[]
  /** Documento origen, si lo hay. */
  origen: { tipo: TipoDocumento; id: string; numero: string } | null
}

/**
 * Un documento vinculado, para el panel de relacionados.
 *
 * `factura` y `pago` no son `TipoDocumento` porque no tienen pantalla propia
 * en esta fase: se muestran, pero no se navega a ellos.
 */
export interface DocumentoRelacionado {
  tipo: TipoDocumento | 'factura' | 'pago'
  id: string
  numero: string
  fecha: string
  estado: string
  moneda: string | null
  total: number | null
}

export interface Relacionados {
  cotizaciones: DocumentoRelacionado[]
  pedidos: DocumentoRelacionado[]
  entregas: DocumentoRelacionado[]
  /** Todavía vacías: `sales_invoices` y `payments` no tienen filas. */
  facturas: DocumentoRelacionado[]
  pagos: DocumentoRelacionado[]
}
