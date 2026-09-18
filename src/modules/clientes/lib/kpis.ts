import type { ClaveKpi, ValorKpi } from '../types'

/**
 * Los KPIs de la ficha rápida.
 *
 * Todo lo de este archivo es función pura y existe por una sola razón: **no
 * sumar monedas**. La web anterior mostraba «Cotizaciones 10.313.498.939,61
 * USD» en su pantalla de inicio, que es lo que pasa cuando se suman pesos y
 * dólares en un mismo total y se le pone la etiqueta de uno de los dos. Un
 * número así no está mal por poco: está mal por tres órdenes de magnitud, y
 * nadie lo nota porque parece un número.
 *
 * Acá cada KPI es una lista de importes, uno por moneda, y la pantalla los
 * muestra separados. Cuando hay una sola moneda se ve un solo importe, que es
 * el caso normal y no tiene por qué verse más complicado.
 */

export interface ImportePorMoneda {
  moneda: string | null
  documentos: number
  importe: number
}

/** Los importes de un KPI, ordenados de mayor a menor. */
export function porMoneda(valores: readonly ValorKpi[], clave: ClaveKpi): ImportePorMoneda[] {
  return valores
    .filter((v) => v.clave === clave)
    .map((v) => ({ moneda: v.moneda, documentos: v.documentos, importe: v.importe }))
    .sort((a, b) => {
      // La moneda desconocida va última: es una ausencia de dato, no una moneda.
      if (a.moneda === null) return 1
      if (b.moneda === null) return -1
      return b.importe - a.importe
    })
}

/** Cuántos documentos, sumando todas las monedas. Contar documentos SÍ se puede. */
export function documentosDe(valores: readonly ValorKpi[], clave: ClaveKpi): number {
  return valores.filter((v) => v.clave === clave).reduce((t, v) => t + v.documentos, 0)
}

export type Variacion =
  | { clase: 'sube' | 'baja' | 'igual'; pct: number }
  /** El mes anterior fue cero: no hay contra qué comparar. */
  | { clase: 'sin_base' }
  /** Este mes fue cero y el anterior también: no hay nada que comparar. */
  | { clase: 'sin_datos' }

/**
 * Comparación contra el mes anterior, **dentro de la misma moneda**.
 *
 * El caso que rompe estas comparaciones es siempre el mismo: el mes anterior
 * en cero. Dividir por cero da infinito y la pantalla termina mostrando
 * «▲ +∞ %» o, peor, «+100 %» como si fuera un dato. No lo es: pasar de nada a
 * algo no tiene porcentaje. Se dice con palabras.
 */
export function variacion(actual: number, anterior: number): Variacion {
  if (anterior === 0) return actual === 0 ? { clase: 'sin_datos' } : { clase: 'sin_base' }
  const pct = ((actual - anterior) / Math.abs(anterior)) * 100
  if (Math.abs(pct) < 0.05) return { clase: 'igual', pct: 0 }
  return { clase: pct > 0 ? 'sube' : 'baja', pct }
}

/** `18.23` → `+18,2 %`. */
export function formatearVariacion(v: Variacion): string {
  if (v.clase === 'sin_base') return 'Sin base de comparación'
  if (v.clase === 'sin_datos') return 'Sin movimientos'
  if (v.clase === 'igual') return 'Igual que el mes anterior'
  const signo = v.pct > 0 ? '+' : '−'
  return `${signo}${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Math.abs(v.pct))} %`
}

/**
 * Empareja un KPI con el del mes anterior, moneda por moneda.
 *
 * Una moneda que aparece este mes y no el anterior sale con `sin_base`; una
 * que aparecía y ya no, sale en cero con su caída. Las dos cosas son
 * información: «este mes empezó a comprar en dólares» y «este mes dejó de
 * comprar en pesos» son frases distintas y las dos importan.
 */
export interface Comparado {
  moneda: string | null
  actual: number
  anterior: number
  documentos: number
  variacion: Variacion
}

export function comparar(
  valores: readonly ValorKpi[],
  clave: ClaveKpi,
  claveAnterior: ClaveKpi,
): Comparado[] {
  const hoy = porMoneda(valores, clave)
  const antes = porMoneda(valores, claveAnterior)
  const monedas: (string | null)[] = []
  for (const f of [...hoy, ...antes]) {
    if (!monedas.some((m) => m === f.moneda)) monedas.push(f.moneda)
  }
  return monedas.map((moneda) => {
    const a = hoy.find((f) => f.moneda === moneda)
    const b = antes.find((f) => f.moneda === moneda)
    return {
      moneda,
      actual: a?.importe ?? 0,
      anterior: b?.importe ?? 0,
      documentos: a?.documentos ?? 0,
      variacion: variacion(a?.importe ?? 0, b?.importe ?? 0),
    }
  })
}

/** `2026-09-01` → `septiembre`. Para el encabezado de los KPIs del mes. */
export function nombreDelMes(iso: string): string {
  const partes = iso.slice(0, 10).split('-')
  const m = Number(partes[1])
  const NOMBRES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ]
  return NOMBRES[m - 1] ?? iso
}
