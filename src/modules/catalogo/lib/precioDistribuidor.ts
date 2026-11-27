/**
 * El precio de VENTA de un distribuidor (2026-11-27) — Fase 3.
 *
 * Su costo es el precio que le da el proveedor (catálogo compartido, Fase 2),
 * en la moneda del proveedor. Sobre eso aplica SU margen —el del rubro si lo
 * tiene, si no el general— y lo pasa a SU moneda con el tipo de cambio que
 * cargó: 1 unidad de la moneda del proveedor = `tipoCambio` de la suya.
 *
 * Puro y sin red: lo usan el catálogo, la ficha y el buscador de líneas, con
 * los ajustes que se leen una vez.
 */

export interface AjustesDistribuidor {
  margenPct: number
  /** category_id → margen, para los rubros con otro margen. */
  margenesRubro: Record<string, number>
  /** `null` = vende en la moneda del proveedor. */
  monedaVenta: string | null
  tipoCambio: number
}

export const AJUSTES_POR_DEFECTO: AjustesDistribuidor = {
  margenPct: 0,
  margenesRubro: {},
  monedaVenta: null,
  tipoCambio: 1,
}

/** El margen que corresponde a un producto: el de su rubro, o el general. */
export function margenPara(categoriaId: string | null, a: AjustesDistribuidor): number {
  if (categoriaId !== null) {
    const m = a.margenesRubro[categoriaId]
    if (typeof m === 'number' && Number.isFinite(m)) return m
  }
  return a.margenPct
}

/** La moneda en la que vende: la suya, o la del proveedor si no eligió. */
export function monedaDeVenta(monedaProveedor: string | null, a: AjustesDistribuidor): string | null {
  return a.monedaVenta ?? monedaProveedor
}

const redondear = (n: number) => Math.round(n * 100) / 100

/**
 * El precio de venta en `monedaDestino` (por defecto, su moneda de venta).
 *
 * Sabe dar el precio en su moneda de venta o en la del proveedor; en cualquier
 * otra devuelve `null`: inventar un tipo de cambio es peor que dejar el precio
 * para que lo carguen a mano.
 */
export function precioDeVenta(
  costo: number | null,
  categoriaId: string | null,
  monedaProveedor: string | null,
  a: AjustesDistribuidor,
  monedaDestino: string | null = monedaDeVenta(monedaProveedor, a),
): number | null {
  if (costo === null || !Number.isFinite(costo)) return null
  const conMargen = costo * (1 + margenPara(categoriaId, a) / 100)
  const venta = monedaDeVenta(monedaProveedor, a)
  if (monedaDestino === null || monedaDestino === monedaProveedor) return redondear(conMargen)
  if (monedaDestino === venta) return redondear(conMargen * a.tipoCambio)
  return null
}
