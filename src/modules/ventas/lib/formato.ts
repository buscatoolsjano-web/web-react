/**
 * Formato de importes y fechas de Ventas.
 *
 * Distinto del formato del Catálogo a propósito: acá `null` NO es
 * "Consultar" —un documento sin total es un dato faltante, no un precio a
 * pedir— y la moneda puede faltar (32 documentos históricos no la tienen).
 */

/** Importe con su moneda. Un total nulo se muestra como raya, nunca como 0. */
export function formatearImporte(monto: number | null, moneda: string | null): string {
  if (monto === null || !Number.isFinite(monto)) return '—'

  const numero = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(monto)

  // Sin moneda se muestra el número solo. Suponer ARS sería inventar: son 32
  // documentos históricos y ninguno dice en qué moneda está.
  return moneda ? `${moneda} ${numero}` : numero
}

/** Cantidad. El 0 es un valor válido y se muestra. */
export function formatearCantidad(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 }).format(n)
}

/**
 * Fecha `YYYY-MM-DD` → `DD/MM/AAAA`.
 *
 * Se parte el string a mano en vez de usar `new Date`: una fecha sin hora se
 * interpreta como UTC y en Argentina (UTC−3) queda un día antes.
 */
export function formatearFecha(iso: string | null): string {
  if (!iso) return '—'
  const partes = iso.slice(0, 10).split('-')
  if (partes.length !== 3) return iso
  const [a, m, d] = partes
  if (!a || !m || !d) return iso
  return `${d}/${m}/${a}`
}
