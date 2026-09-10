import type { LineaPedidoCompra } from '../types'

/**
 * Construcción y cuentas de las líneas del pedido de compra.
 *
 * Todo función pura. Los totales que valen son los del servidor
 * —`app.totales_pedido_compra()`, empujados por trigger—; lo de acá existe
 * para mostrar el neto de una línea mientras se escribe, antes de guardar.
 * Si alguna vez las dos cuentas difieren, la que está mal es ésta.
 */

let contador = 0

function nuevoId(): string {
  // `crypto.randomUUID` no existe en contextos no seguros; el contador
  // alcanza porque estos ids sólo viven mientras se edita.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  contador += 1
  return `tmp-${Date.now()}-${contador}`
}

const BASE: Omit<LineaPedidoCompra, 'id' | 'numeroLinea'> = {
  tipoLinea: 'product',
  productId: null,
  sku: null,
  nombre: null,
  descripcion: null,
  cantidad: 1,
  // Cero, no un precio de venta: no hay costo en el backend y sugerir el
  // precio del Catálogo sería confundir lo que se cobra con lo que se paga.
  precioUnitario: 0,
  descuentoPct: 0,
  tratamientoImpuesto: 'vat_21',
  tasaImpuesto: 21,
  netoServidor: 0,
}

export interface ProductoElegido {
  id: string
  sku: string
  nombre: string
}

export function lineaDeProducto(p: ProductoElegido, numeroLinea: number): LineaPedidoCompra {
  return {
    ...BASE,
    id: nuevoId(),
    numeroLinea,
    productId: p.id,
    sku: p.sku,
    nombre: p.nombre,
  }
}

/** Una línea libre: se compra algo que no está en el catálogo. */
export function lineaLibre(numeroLinea: number): LineaPedidoCompra {
  return { ...BASE, id: nuevoId(), numeroLinea }
}

/** Un título que agrupa líneas y no suma. */
export function lineaCapitulo(numeroLinea: number): LineaPedidoCompra {
  return {
    ...BASE,
    id: nuevoId(),
    numeroLinea,
    tipoLinea: 'chapter',
    nombre: 'Nuevo capítulo',
    cantidad: 1,
    precioUnitario: 0,
    tratamientoImpuesto: 'not_taxed',
    tasaImpuesto: 0,
  }
}

/** Renumera 1..n conservando el orden actual. */
export function renumerar(lineas: readonly LineaPedidoCompra[]): LineaPedidoCompra[] {
  return lineas.map((l, i) => ({ ...l, numeroLinea: i + 1 }))
}

/** Mueve una línea una posición. Devuelve la misma lista si no se puede. */
export function mover(
  lineas: readonly LineaPedidoCompra[],
  id: string,
  direccion: -1 | 1,
): LineaPedidoCompra[] {
  const i = lineas.findIndex((l) => l.id === id)
  const j = i + direccion
  if (i < 0 || j < 0 || j >= lineas.length) return [...lineas]
  const copia = [...lineas]
  const a = copia[i]
  const b = copia[j]
  if (!a || !b) return copia
  copia[i] = b
  copia[j] = a
  return renumerar(copia)
}

/** Neto de una línea: cantidad × precio − descuento. Un capítulo no suma. */
export function netoDeLinea(l: LineaPedidoCompra): number {
  if (l.tipoLinea === 'chapter') return 0
  return l.cantidad * (l.precioUnitario ?? 0) * (1 - (l.descuentoPct ?? 0) / 100)
}

export interface TotalesPrevios {
  /** Cantidad × precio, antes de descuentos. */
  bruto: number
  /** Lo que se ahorró por descuento de línea. */
  descuento: number
  subtotal: number
  impuesto: number
  total: number
}

/**
 * Previsualización de los totales.
 *
 * Mismo orden que `app.totales_pedido_compra`: neto de línea, después IVA por
 * línea con la alícuota de su tratamiento. No hay descuento global ni
 * percepción en un pedido de compra: no existen en el schema y no se
 * inventan.
 */
export function totalesPrevios(lineas: readonly LineaPedidoCompra[]): TotalesPrevios {
  const redondear = (n: number) => Math.round(n * 100) / 100
  let bruto = 0
  let neto = 0
  let iva = 0
  for (const l of lineas) {
    if (l.tipoLinea === 'chapter') continue
    bruto += l.cantidad * (l.precioUnitario ?? 0)
    const n = netoDeLinea(l)
    neto += n
    iva += n * ((l.tasaImpuesto ?? 0) / 100)
  }
  const subtotal = redondear(neto)
  const impuesto = redondear(iva)
  return {
    bruto: redondear(bruto),
    descuento: redondear(bruto - neto),
    subtotal,
    impuesto,
    total: redondear(subtotal + impuesto),
  }
}

/** Qué le falta a una línea para poder guardarse. */
export function problemasDeLinea(l: LineaPedidoCompra): string[] {
  const p: string[] = []
  if (l.tipoLinea === 'chapter') {
    if (!(l.nombre ?? '').trim()) p.push('El capítulo necesita un título.')
    return p
  }
  if (l.productId === null && !(l.nombre ?? '').trim() && !(l.sku ?? '').trim()) {
    p.push('Una línea libre necesita al menos una referencia o una descripción.')
  }
  if (!(l.cantidad > 0)) p.push('La cantidad tiene que ser mayor que cero.')
  if (l.precioUnitario !== null && l.precioUnitario < 0) p.push('El precio no puede ser negativo.')
  if (l.descuentoPct < 0 || l.descuentoPct > 100) p.push('El descuento va entre 0 y 100.')
  if (l.tratamientoImpuesto === 'other' && l.tasaImpuesto === null) {
    p.push('«Otra alícuota» necesita que escribas cuál.')
  }
  return p
}
