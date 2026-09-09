import type { LineaDocumento } from '../types'

/**
 * La misma cuenta que hace el servidor, pero SÓLO para previsualizar.
 *
 * El total que vale es el que devuelve la base: lo calcula el trigger
 * `app.recalcular_totales_cotizacion` a partir de las líneas, el descuento
 * global y la percepción. Esto de acá existe para que el editor pueda
 * mostrar el neto de una línea mientras se escribe, antes de guardar.
 *
 * Si las dos cuentas alguna vez difieren, la que está mal es esta.
 */

/** Neto de una línea: cantidad × precio − descuento. Un capítulo no suma. */
export function netoDeLinea(l: LineaDocumento): number {
  if (l.tipoLinea === 'chapter') return 0
  const precio = l.precioUnitario ?? 0
  return l.cantidad * precio * (1 - (l.descuentoPct ?? 0) / 100)
}

export function netoDeLineas(lineas: readonly LineaDocumento[]): number {
  return lineas.reduce((s, l) => s + netoDeLinea(l), 0)
}

export interface TotalesPrevios {
  subtotal: number
  impuesto: number
  total: number
}

/**
 * Previsualización de los totales del documento.
 *
 * Orden de aplicación, igual que en `app.totales_cotizacion`:
 *   neto de línea → descuento global → IVA por línea → percepción.
 */
export function totalesPrevios(
  lineas: readonly LineaDocumento[],
  descuentoGlobalPct: number | null,
  percepcionPct: number | null,
): TotalesPrevios {
  const factor = 1 - (descuentoGlobalPct ?? 0) / 100
  const redondear = (n: number) => Math.round(n * 100) / 100

  let neto = 0
  let iva = 0
  for (const l of lineas) {
    const n = netoDeLinea(l)
    neto += n
    iva += n * factor * ((l.tasaImpuesto ?? 0) / 100)
  }

  const subtotal = redondear(neto * factor)
  const impuesto = redondear(redondear(iva) + (subtotal * (percepcionPct ?? 0)) / 100)
  return { subtotal, impuesto, total: subtotal + impuesto }
}
