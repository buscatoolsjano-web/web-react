import type {
  FacturaDetalle,
  LineaFactura,
  LineaPedidoCompra,
  LineaRecepcion,
  PedidoCompraDetalle,
  RecepcionDetalle,
} from '../types'

/**
 * Lo que se imprime en Compras.
 *
 * Se arma **sólo con los snapshots del documento**. Nunca se consulta el
 * nombre ni el precio actual del producto, ni se recalcula un total: un
 * documento tiene que imprimirse siempre igual a como se imprimió el día que
 * se emitió.
 *
 * ## Por qué acá NO hay seis formatos como en Ventas
 *
 * El legacy usaba **un solo modal de impresión para todo**, con los mismos
 * seis formatos —valorado, sin valorar, sin impuestos, pro forma, sin totales,
 * ticket— para cotizaciones, pedidos de venta, notas de entrega y también para
 * los dos documentos de compra que sabía imprimir (`pc` y `np`). Esos seis no
 * fueron pensados para Compras: son la lista de Ventas reutilizada.
 *
 * Mirados de a uno, en Compras casi ninguno significa algo:
 *
 *   · **sin valorar** en un pedido a proveedor es un pedido sin precios, o
 *     sea sin lo único que hay que acordar con él.
 *   · **pro forma** es un documento comercial que se le manda a un cliente.
 *   · **ticket** es un comprobante de mostrador.
 *   · **sin totales / sin impuestos** esconden justamente lo que el proveedor
 *     tiene que confirmar.
 *
 * Así que cada documento tiene **un formato**, el suyo, y lo único que se
 * elige es el tamaño del papel —que en el legacy también era real—.
 *
 * La recepción es el caso más claro: **no está valorizada** en el schema, así
 * que se imprime como el documento logístico que es. Ponerle precios
 * obligaría a ir a buscarlos al pedido, y eso sería inventar un documento que
 * no existe.
 */

export type TipoImpresion = 'pedido' | 'recepcion' | 'factura'

export const TITULO_DE: Record<TipoImpresion, string> = {
  pedido: 'PEDIDO A PROVEEDOR',
  recepcion: 'NOTA DE ENTRADA DE PROVEEDOR',
  factura: 'FACTURA DE PROVEEDOR',
}

export interface OpcionesImpresion {
  papel: 'A4' | 'carta'
}

export const OPCIONES_INICIALES: OpcionesImpresion = { papel: 'A4' }

export interface EmpresaImpresion {
  nombre: string
  razonSocial: string | null
  cuit: string | null
  direccion: string | null
  telefono: string | null
  email: string | null
  web: string | null
  color: string
}

export interface LineaImpresa {
  id: string
  esCapitulo: boolean
  numero: number | null
  sku: string | null
  nombre: string | null
  descripcion: string | null
  cantidad: number
  /** `null` en la recepción: no está valorizada. */
  precio: number | null
  descuentoPct: number
  /** La etiqueta del tratamiento, no el código. `null` si no se imprime. */
  impuesto: string | null
  /** El neto que calculó el servidor. `null` en la recepción. */
  neto: number | null
  /** Sólo en la factura: de qué recepción viene esta línea. */
  origen: string | null
}

/** Un dato de la cabecera. Los que faltan NO se imprimen en vez de salir vacíos. */
export interface DatoImpreso {
  etiqueta: string
  valor: string
}

export interface DocumentoImprimible {
  tipo: TipoImpresion
  titulo: string
  numero: string
  fecha: string
  proveedor: string
  /** `null` en la recepción, que no lleva importes. */
  moneda: string | null
  datos: DatoImpreso[]
  lineas: LineaImpresa[]
  /** `null` cuando el documento no lleva totales. */
  totales: { subtotal: number; impuesto: number; total: number } | null
  notas: string | null
  /** Lo que cuelga del documento, ya resuelto a texto por quien llama. */
  relacionados: string[]
}

const dato = (etiqueta: string, valor: string | null | undefined): DatoImpreso[] =>
  valor === null || valor === undefined || String(valor).trim() === ''
    ? []
    : [{ etiqueta, valor: String(valor) }]

/** La fecha, en el formato de la casa. */
function fechaCorta(iso: string | null): string | null {
  if (!iso) return null
  const [a, m, d] = iso.slice(0, 10).split('-')
  return a && m && d ? `${d}/${m}/${a}` : iso
}

// ── Pedido de compra ───────────────────────────────────────────────────────

/**
 * El pedido que se le manda al proveedor.
 *
 * Lleva precios, impuestos y totales: es lo que se está acordando pagar. La
 * ETA y la condición de pago salen del documento y **sólo si están**; no se
 * inventa un plazo de entrega que nadie pactó.
 */
export function imprimiblePedido(
  doc: PedidoCompraDetalle,
  lineas: readonly LineaPedidoCompra[],
  etiquetaImpuesto: (t: string) => string,
): DocumentoImprimible {
  return {
    tipo: 'pedido',
    titulo: TITULO_DE.pedido,
    numero: doc.numero,
    fecha: doc.fecha,
    proveedor: doc.proveedor,
    moneda: doc.moneda,
    datos: [
      ...dato('Proveedor', doc.proveedor),
      ...dato('Referencia del proveedor', doc.proveedorReferencia),
      ...dato('Moneda', doc.moneda),
      ...dato('Tipo de cambio', doc.tipoCambio === null ? null : String(doc.tipoCambio)),
      ...dato('Entrega estimada', fechaCorta(doc.fechaEstimada)),
      ...dato('Condición de pago', doc.formaPago),
    ],
    lineas: lineas.map((l) => ({
      id: l.id,
      esCapitulo: l.tipoLinea === 'chapter',
      numero: l.tipoLinea === 'chapter' ? null : l.numeroLinea,
      sku: l.sku,
      nombre: l.nombre,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precio: l.precioUnitario,
      descuentoPct: l.descuentoPct,
      impuesto: etiquetaImpuesto(l.tratamientoImpuesto),
      neto: l.netoServidor,
      origen: null,
    })),
    totales: { subtotal: doc.subtotal, impuesto: doc.impuesto, total: doc.total },
    notas: doc.notas,
    relacionados: [],
  }
}

// ── Recepción ──────────────────────────────────────────────────────────────

/**
 * La nota de entrada: un documento **logístico**.
 *
 * Sin precios, sin impuestos y sin totales, porque `goods_receipt_lines` no
 * tiene ninguna columna de importe. Lo que se firma acá es que llegaron estas
 * cantidades de estas cosas a este depósito.
 */
export function imprimibleRecepcion(
  doc: RecepcionDetalle,
  lineas: readonly LineaRecepcion[],
): DocumentoImprimible {
  return {
    tipo: 'recepcion',
    titulo: TITULO_DE.recepcion,
    numero: doc.numero,
    fecha: doc.fecha,
    proveedor: doc.proveedor,
    moneda: null,
    datos: [
      ...dato('Proveedor', doc.proveedor),
      ...dato('Pedido de compra', doc.pedidoNumero),
      ...dato('Depósito', doc.deposito),
      ...dato('Remito del proveedor', doc.documentoProveedor),
    ],
    lineas: lineas.map((l, i) => ({
      id: l.id,
      esCapitulo: false,
      numero: i + 1,
      sku: l.sku,
      nombre: l.descripcion,
      descripcion: null,
      cantidad: l.cantidad,
      precio: null,
      descuentoPct: 0,
      impuesto: null,
      neto: null,
      origen: null,
    })),
    totales: null,
    notas: doc.notas,
    relacionados: doc.pedidoNumero ? [doc.pedidoNumero] : [],
  }
}

// ── Factura de proveedor ───────────────────────────────────────────────────

/**
 * La factura, como la mandó el proveedor.
 *
 * El título grande es **su** número, el del papel; la referencia interna `FP`
 * va como un dato más. Se imprime lo que se cargó, sin arreglar nada: si el
 * proveedor facturó a otro precio que la orden, sale ese precio.
 */
export function imprimibleFactura(
  doc: FacturaDetalle,
  lineas: readonly LineaFactura[],
  etiquetaImpuesto: (t: string) => string,
  relacionados: readonly string[] = [],
): DocumentoImprimible {
  return {
    tipo: 'factura',
    titulo: TITULO_DE.factura,
    numero: doc.numeroProveedor ?? doc.numero,
    fecha: doc.fecha,
    proveedor: doc.proveedor,
    moneda: doc.moneda,
    datos: [
      ...dato('Proveedor', doc.proveedor),
      ...dato('Número del proveedor', doc.numeroProveedor),
      ...dato('Referencia interna', doc.numero),
      ...dato('Moneda', doc.moneda),
      ...dato('Tipo de cambio', doc.tipoCambio === null ? null : String(doc.tipoCambio)),
      ...dato('Vencimiento', fechaCorta(doc.vencimiento)),
      ...dato('Condición de pago', doc.formaPago),
    ],
    lineas: lineas.map((l) => ({
      id: l.id,
      esCapitulo: false,
      numero: l.numeroLinea,
      sku: l.sku,
      nombre: l.descripcion,
      descripcion: null,
      cantidad: l.cantidad,
      precio: l.precioUnitario,
      descuentoPct: l.descuentoPct,
      impuesto: etiquetaImpuesto(l.tratamientoImpuesto),
      neto: l.netoServidor,
      origen: l.recepcionNumero,
    })),
    totales: { subtotal: doc.subtotal, impuesto: doc.impuesto, total: doc.total },
    notas: doc.notas,
    relacionados: [...relacionados],
  }
}

/** Qué columnas lleva la tabla de cada tipo. */
export function columnasDe(tipo: TipoImpresion): {
  origen: boolean
  precios: boolean
  impuesto: boolean
} {
  return {
    origen: tipo === 'factura',
    precios: tipo !== 'recepcion',
    impuesto: tipo !== 'recepcion',
  }
}
