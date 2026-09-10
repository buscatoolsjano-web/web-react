/**
 * Tipos del módulo de Compras.
 *
 * La entrega 2 es sólo el maestro de proveedores. Los pedidos de compra, las
 * recepciones y las facturas de proveedor tienen su schema desde la entrega 1
 * pero todavía no tienen pantalla: lo que aparece de ellos acá es el estado
 * «no hay ninguno», que es un dato verdadero y no un placeholder.
 */

/** Una fila del listado de proveedores. */
export interface ProveedorListado {
  id: string
  /** `PROV00008`. Es la referencia del legacy, no la identidad: ésa es el uuid. */
  referencia: string | null
  razonSocial: string
  nombreComercial: string | null
  /** Código de dos letras. */
  pais: string | null
  telefono: string | null
  email: string | null
  formaPago: string | null
  /** `active` | `inactive`. */
  estado: string
  /** `true` si vino de la migración del maestro legacy. */
  esHistorico: boolean
  necesitaRevision: boolean
  motivosRevision: string[]
  /** `deleted_at` no nulo: el proveedor está dado de baja, no borrado. */
  dadoDeBaja: boolean
}

export interface PaginaDeProveedores {
  filas: ProveedorListado[]
  total: number
}

export type OrdenProveedores = 'nombre' | 'referencia' | 'pais' | 'formaPago'
export type DireccionOrden = 'asc' | 'desc'

export interface FiltrosProveedores {
  /** Búsqueda libre: razón social, nombre comercial, referencia o email. */
  q: string
  /** `''` = todos, `active`, `inactive`. */
  estado: string
  /** Sólo los que la migración dejó marcados. */
  soloRevision: boolean
  /** Incluir los dados de baja. Por defecto NO se ven. */
  incluirBajas: boolean
  pagina: number
  porPagina: number
  orden: OrdenProveedores
  direccion: DireccionOrden
}

export const FILTROS_INICIALES: FiltrosProveedores = {
  q: '',
  estado: '',
  soloRevision: false,
  incluirBajas: false,
  pagina: 1,
  porPagina: 25,
  orden: 'nombre',
  direccion: 'asc',
}

export interface ProveedorDetalle {
  id: string
  referencia: string | null
  razonSocial: string
  nombreComercial: string | null
  cuit: string | null
  email: string | null
  telefono: string | null
  /** La dirección del legacy, ENTERA y tal cual. Nunca se partió. */
  direccion: string | null
  pais: string | null
  actividad: string | null
  /** En el legacy es siempre «BUSCATOOLS». Es un dato histórico, no un permiso. */
  agente: string | null
  formaPago: string | null
  monedaPorDefecto: string | null
  notas: string | null
  estado: string
  esHistorico: boolean
  origenLegacy: string | null
  necesitaRevision: boolean
  motivosRevision: string[]
  dadoDeBaja: boolean
  creadoEn: string
}

/** Qué hay de este proveedor en el circuito de compras. */
export interface ComprasDelProveedor {
  pedidos: number
  recepciones: number
  facturas: number
}

/** Un evento de `purchases_audit`. */
export interface EventoDeProveedor {
  id: number
  accion: string
  estadoAnterior: string | null
  estadoNuevo: string | null
  autor: string | null
  fecha: string
  diff: Record<string, unknown> | null
}

// ── Pedidos de compra ──────────────────────────────────────────────────────

/** `draft` | `confirmed` | `cancelled`, los tres del CHECK. */
export type EstadoPedido = 'draft' | 'confirmed' | 'cancelled'

/** Derivado por la base. La aplicación nunca lo escribe. */
export type EstadoRecepcion = 'pending' | 'partially_received' | 'received'

export interface PedidoCompraListado {
  id: string
  numero: string
  fecha: string
  proveedorId: string
  proveedor: string
  moneda: string
  total: number
  estado: EstadoPedido
  estadoRecepcion: EstadoRecepcion
  /** ETA. `null` = no se conoce; no se inventa una. */
  fechaEstimada: string | null
  autor: string | null
  lineas: number
}

export interface PaginaDePedidos {
  filas: PedidoCompraListado[]
  total: number
}

export type OrdenPedidos = 'fecha' | 'numero' | 'proveedor' | 'total' | 'eta'

export interface FiltrosPedidos {
  /** Número de pedido, exacto o parcial. */
  q: string
  proveedorId: string | null
  estado: string
  estadoRecepcion: string
  moneda: string
  /** `order_date` entre estas dos, inclusive. */
  desde: string
  hasta: string
  /** `expected_date` entre estas dos, inclusive. */
  etaDesde: string
  etaHasta: string
  /** Sólo los que no tienen ETA cargada. */
  sinEta: boolean
  pagina: number
  porPagina: number
  orden: OrdenPedidos
  direccion: DireccionOrden
}

export const FILTROS_PEDIDOS_INICIALES: FiltrosPedidos = {
  q: '',
  proveedorId: null,
  estado: '',
  estadoRecepcion: '',
  moneda: '',
  desde: '',
  hasta: '',
  etaDesde: '',
  etaHasta: '',
  sinEta: false,
  pagina: 1,
  porPagina: 25,
  orden: 'fecha',
  direccion: 'desc',
}

/**
 * Una línea del pedido.
 *
 * `id` es un uuid de verdad —el de la base, o uno local mientras se edita—,
 * nunca la posición en el array. El legacy usaba el índice como identidad y
 * de ahí salió el `entregado[idx]` que hubo que reconstruir a mano.
 */
export interface LineaPedidoCompra {
  id: string
  numeroLinea: number
  /** `product` (del catálogo o libre) o `chapter` (un título que no suma). */
  tipoLinea: 'product' | 'chapter'
  /** `null` en una línea libre: se compra algo que no está en el catálogo. */
  productId: string | null
  sku: string | null
  nombre: string | null
  descripcion: string | null
  cantidad: number
  /** Precio de COMPRA. Se escribe a mano: no hay costo en el backend. */
  precioUnitario: number | null
  descuentoPct: number
  tratamientoImpuesto: string
  /** `null` sólo mientras el tratamiento es `other` y nadie la escribió. */
  tasaImpuesto: number | null
  /** Lo que calculó el servidor para esta línea. */
  netoServidor: number
}

export interface PedidoCompraDetalle {
  id: string
  numero: string
  serie: string
  estado: EstadoPedido
  estadoRecepcion: EstadoRecepcion
  proveedorId: string
  proveedor: string
  proveedorReferencia: string | null
  moneda: string
  tipoCambio: number | null
  fecha: string
  fechaEstimada: string | null
  formaPago: string | null
  notas: string | null
  subtotal: number
  impuesto: number
  total: number
  autor: string | null
  creadoEn: string
  actualizadoEn: string
  /** `true` si hay al menos una recepción confirmada: las líneas se congelan. */
  conRecepcion: boolean
}

/** Lo que hay colgando del pedido. Las dos últimas están vacías hasta la 4. */
export interface RelacionadosPedido {
  recepciones: number
  facturas: number
}

/** El último precio pagado por un producto, de un pedido confirmado. */
export interface UltimoPrecioCompra {
  productId: string
  precio: number
  descuentoPct: number
  numero: string
  fecha: string
  proveedor: string
}

// ── Recepciones (notas de entrada de proveedor) ────────────────────────────

/** Los dos del CHECK de `goods_receipts.status`. No hay más. */
export type EstadoRecepcionDoc = 'draft' | 'confirmed'

export interface RecepcionListado {
  id: string
  numero: string
  fecha: string
  proveedorId: string
  proveedor: string
  pedidoId: string | null
  pedidoNumero: string | null
  depositoId: string
  deposito: string
  estado: EstadoRecepcionDoc
  lineas: number
  /** Suma de las cantidades de sus líneas. */
  unidades: number
  autor: string | null
}

export interface PaginaDeRecepciones {
  filas: RecepcionListado[]
  total: number
}

export type OrdenRecepciones = 'fecha' | 'numero' | 'proveedor' | 'pedido'

export interface FiltrosRecepciones {
  /** Número de recepción, exacto o parcial. */
  q: string
  proveedorId: string | null
  pedidoId: string | null
  estado: string
  depositoId: string | null
  desde: string
  hasta: string
  pagina: number
  porPagina: number
  orden: OrdenRecepciones
  direccion: DireccionOrden
}

export const FILTROS_RECEPCIONES_INICIALES: FiltrosRecepciones = {
  q: '',
  proveedorId: null,
  pedidoId: null,
  estado: '',
  depositoId: null,
  desde: '',
  hasta: '',
  pagina: 1,
  porPagina: 25,
  orden: 'fecha',
  direccion: 'desc',
}

/**
 * Una línea del pedido, con su cuenta de recepción.
 *
 * Sale de `public.pendiente_de_pedido()`. `enBorrador` **no está reservado**:
 * es lo que otras recepciones en borrador ya anotaron sobre esta misma línea.
 * Se muestra para que quien recibe lo sepa antes de confirmar, no para
 * bloquear nada.
 */
export interface PendienteDeLinea {
  purchaseOrderLineId: string
  numeroLinea: number
  /** `null` en una línea libre: no está en el catálogo y no mueve stock. */
  productId: string | null
  sku: string | null
  descripcion: string | null
  pedido: number
  recibido: number
  enBorrador: number
  pendiente: number
  /** Los números de las recepciones en borrador que tocan esta línea. */
  borradores: string[]
  /** Lo que hay hoy en el depósito elegido. Sólo si la línea tiene producto. */
  stockActual: number | null
}

/** Una línea de la recepción, tal como está guardada. */
export interface LineaRecepcion {
  id: string
  purchaseOrderLineId: string | null
  productId: string | null
  sku: string | null
  descripcion: string | null
  cantidad: number
}

export interface RecepcionDetalle {
  id: string
  numero: string
  serie: string
  estado: EstadoRecepcionDoc
  fecha: string
  proveedorId: string
  proveedor: string
  pedidoId: string | null
  pedidoNumero: string | null
  depositoId: string
  deposito: string
  documentoProveedor: string | null
  notas: string | null
  autor: string | null
  confirmadaEn: string | null
  confirmadaPor: string | null
  creadoEn: string
}

export interface Deposito {
  id: string
  codigo: string
  nombre: string
  esPorDefecto: boolean
}

// ── Facturas de proveedor ──────────────────────────────────────────────────

/** Los tres del CHECK de `supplier_invoices.status`. Ojo: `registered`. */
export type EstadoFactura = 'draft' | 'registered' | 'cancelled'

export interface FacturaListado {
  id: string
  /** La referencia interna `FP00001`. No es el número del proveedor. */
  numero: string
  /** El número REAL de la factura del proveedor. Puede faltar en un borrador. */
  numeroProveedor: string | null
  fecha: string
  vencimiento: string | null
  proveedorId: string
  proveedor: string
  moneda: string
  total: number
  estado: EstadoFactura
  lineas: number
  /** Cuántas recepciones distintas toca. Una factura puede cubrir varias. */
  recepciones: number
  autor: string | null
}

export interface PaginaDeFacturas {
  filas: FacturaListado[]
  total: number
}

export type OrdenFacturas = 'fecha' | 'numero' | 'numeroProveedor' | 'proveedor' | 'total'

export interface FiltrosFacturas {
  /** Busca en la referencia interna y en el número del proveedor. */
  q: string
  proveedorId: string | null
  estado: string
  moneda: string
  desde: string
  hasta: string
  pagina: number
  porPagina: number
  orden: OrdenFacturas
  direccion: DireccionOrden
}

export const FILTROS_FACTURAS_INICIALES: FiltrosFacturas = {
  q: '',
  proveedorId: null,
  estado: '',
  moneda: '',
  desde: '',
  hasta: '',
  pagina: 1,
  porPagina: 25,
  orden: 'fecha',
  direccion: 'desc',
}

/**
 * Una línea de recepción con su cuenta de facturación.
 *
 * Sale de `public.pendiente_de_facturar()`. `enBorrador` **no reserva**: es lo
 * que otras facturas en borrador ya anotaron sobre la misma línea.
 */
export interface PendienteDeFacturar {
  goodsReceiptLineId: string
  recepcionId: string
  recepcionNumero: string
  recepcionFecha: string
  purchaseOrderLineId: string | null
  pedidoId: string | null
  pedidoNumero: string | null
  moneda: string | null
  productId: string | null
  sku: string | null
  descripcion: string | null
  recibido: number
  facturado: number
  enBorrador: number
  pendiente: number
  /** El costo que quedó en la orden. Es el punto de partida, no una atadura. */
  precioPedido: number | null
  tratamientoPedido: string | null
  cantidadPedida: number | null
}

/** Una línea de la factura, tal como está guardada. */
export interface LineaFactura {
  id: string
  numeroLinea: number
  goodsReceiptLineId: string | null
  purchaseOrderLineId: string | null
  productId: string | null
  sku: string | null
  descripcion: string | null
  cantidad: number
  precioUnitario: number
  descuentoPct: number
  tratamientoImpuesto: string
  tasaImpuesto: number | null
  netoServidor: number
  /** El número de la recepción de la que sale, si sale de alguna. */
  recepcionNumero: string | null
  pedidoNumero: string | null
  /** Lo que decía la orden, para poder mostrar la diferencia. */
  precioPedido: number | null
  tratamientoPedido: string | null
}

export interface FacturaDetalle {
  id: string
  numero: string
  serie: string
  numeroProveedor: string | null
  estado: EstadoFactura
  proveedorId: string
  proveedor: string
  moneda: string
  tipoCambio: number | null
  fecha: string
  vencimiento: string | null
  formaPago: string | null
  notas: string | null
  subtotal: number
  impuesto: number
  total: number
  autor: string | null
  creadoEn: string
  actualizadoEn: string
}

/** Los documentos que quedan del otro lado de las líneas. */
export interface RelacionadosFactura {
  recepciones: { id: string; numero: string; fecha: string }[]
  pedidos: { id: string; numero: string }[]
}

/**
 * Una diferencia entre lo que dice la factura y lo que decía la orden.
 *
 * Se DERIVA comparando la línea con el snapshot del pedido. No hay ninguna
 * tabla de discrepancias y no se creó una: cuando haga falta un motor de
 * conciliación de verdad será una decisión aparte.
 */
export interface DiferenciaConPedido {
  lineaId: string
  numeroLinea: number
  tipo: 'precio' | 'impuesto'
  enPedido: string
  enFactura: string
}
