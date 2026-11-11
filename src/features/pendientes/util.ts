/** Lo que comparten las dos pantallas de pendientes (Fase 238). */

export type Tono = 'tEntregado' | 'tStock' | 'tCamino' | 'tFalta' | 'tAtrasado' | 'tNeutro'

/** Cuántos meses mirar hacia atrás; `null` es todo. */
export type Rango = 3 | 6 | 12 | null

export const RANGOS: readonly { valor: Rango; texto: string }[] = [
  { valor: 3, texto: '3 meses' },
  { valor: 6, texto: '6 meses' },
  { valor: 12, texto: '1 año' },
  { valor: null, texto: 'Todo' },
]

export function desdeDe(rango: Rango, hoy = new Date()): string | null {
  if (rango === null) return null
  const d = new Date(hoy)
  d.setMonth(d.getMonth() - rango)
  return d.toISOString().slice(0, 10)
}

export function fmt(x: number): string {
  return Number.isInteger(x) ? x.toLocaleString('es-AR') : x.toLocaleString('es-AR', { maximumFractionDigits: 2 })
}

export function fechaCorta(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return a && m && d ? `${d}/${m}/${a}` : iso
}
