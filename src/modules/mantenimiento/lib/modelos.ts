/**
 * Modelos de herramienta: cruce con los equipos y límites de torque.
 *
 * En la base el modelo de un equipo está escrito de muchas formas —«ASM18-12-
 * PC», «ASM 18-12-PC», «FEIN ASM18-8-PC»—. Se compara normalizado: sin la
 * marca, sin espacios, sin el sufijo «-PC» y en mayúsculas.
 */

export function normalizarModelo(texto: string | null | undefined): string {
  if (!texto) return ''
  return texto
    .toUpperCase()
    .replace(/FEIN/g, '')
    .replace(/\s+/g, '')
    .replace(/-?PC$/, '')
    .replace(/^-+|-+$/g, '')
}

/** Redondeo a dos decimales sin arrastrar el error de coma flotante. */
const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * LCI y LCS a partir del nominal y la precisión del modelo (±10 % en los FEIN
 * AccuTec, Cmk > 1,67 según ISO 5393 / VDI 2647).
 */
export function limitesPorPrecision(nominal: number, precisionPct: number): { lsl: number; usl: number } {
  return { lsl: r2(nominal * (1 - precisionPct / 100)), usl: r2(nominal * (1 + precisionPct / 100)) }
}

/** Si el nominal pedido está fuera de lo que la herramienta puede dar. */
export function fueraDeRango(nominal: number | null, rango: { min: number; max: number }): boolean {
  return nominal !== null && Number.isFinite(nominal) && (nominal < rango.min || nominal > rango.max)
}
