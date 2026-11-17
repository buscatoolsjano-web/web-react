/**
 * Tramos para los atributos numéricos de la guía. PURO.
 *
 * «Quiero filtrar una punta Phillips 2 de 50.» El largo tiene 200 valores
 * distintos en Puntas y tubos (25, 26, 28, 29, 30, 32…): como botones son
 * ilegibles y por eso la guía no lo ofrecía. En tramos —«Hasta 25 mm»,
 * «26 a 50 mm», «51 a 100 mm»…— son seis botones que cualquiera entiende.
 *
 * Los cortes salen de los valores reales (cuántos productos hay de cada uno)
 * redondeados a números «lindos» (5, 10, 25, 50, 100…), así cada tramo junta
 * una cantidad parecida de productos y ningún botón queda vacío.
 */

export interface Tramo {
  id: string
  etiqueta: string
  /** Extremos para el filtro de rango (inclusivos). null = abierto. */
  min: number | null
  max: number | null
  cantidad: number
}

export interface ValorConCantidad {
  valor: string
  cuantos: number
}

export function aNumero(s: string): number | null {
  const t = s.trim().replace(',', '.')
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null
}

/** ¿Es un atributo numérico? (casi todos sus valores son números) */
export function esNumerico(opciones: readonly ValorConCantidad[]): boolean {
  if (opciones.length === 0) return false
  const num = opciones.filter((o) => aNumero(o.valor) !== null).reduce((a, o) => a + o.cuantos, 0)
  const total = opciones.reduce((a, o) => a + o.cuantos, 0)
  return total > 0 && num / total >= 0.9
}

/** El número «lindo» más chico que es >= x: 1, 2, 2.5, 3, 5, 7.5 × 10^n. */
export function redondearLindo(x: number): number {
  if (x <= 0) return 0
  const exp = Math.floor(Math.log10(x))
  const base = 10 ** exp
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10]) {
    const c = m * base
    if (c >= x - 1e-9) return Number(c.toPrecision(6))
  }
  return 10 * base
}

function formatear(n: number): string {
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 })
}

/**
 * Los tramos de un atributo numérico. `maximo` es cuántos botones como mucho.
 * Con pocos valores distintos (5 o menos) no hacen falta tramos: devuelve [] y
 * la guía los muestra como botones sueltos.
 */
export function tramosDe(opciones: readonly ValorConCantidad[], unidad: string | null, maximo = 6): Tramo[] {
  const puntos = opciones
    .map((o) => ({ v: aNumero(o.valor), c: o.cuantos }))
    .filter((p): p is { v: number; c: number } => p.v !== null && p.c > 0)
    .sort((a, b) => a.v - b.v)
  if (puntos.length <= 5) return []

  const total = puntos.reduce((a, p) => a + p.c, 0)
  const enteros = puntos.every((p) => Number.isInteger(p.v))
  const u = unidad ? ` ${unidad}` : ''

  // Cortes por cantidad acumulada, redondeados a números lindos.
  const cortes: number[] = []
  let acumulado = 0
  let siguiente = 1
  for (const p of puntos) {
    acumulado += p.c
    while (siguiente < maximo && acumulado >= (total * siguiente) / maximo) {
      const corte = redondearLindo(p.v)
      if (cortes.length === 0 || corte > cortes[cortes.length - 1]!) cortes.push(corte)
      siguiente++
    }
  }
  const ultimo = puntos[puntos.length - 1]!.v
  const cortesUtiles = cortes.filter((c) => c < ultimo)
  if (cortesUtiles.length === 0) return []

  const tramos: Tramo[] = []
  let desde: number | null = null
  for (const hasta of [...cortesUtiles, null]) {
    const dentro = puntos.filter((p) => (desde === null || p.v > desde) && (hasta === null || p.v <= hasta))
    const cantidad = dentro.reduce((a, p) => a + p.c, 0)
    if (cantidad > 0) {
      // Con valores enteros, «26 a 50»; con decimales, «más de 25 a 50».
      const piso = desde === null ? null : enteros ? desde + 1 : desde
      const etiqueta =
        desde === null
          ? `Hasta ${formatear(hasta!)}${u}`
          : hasta === null
            ? `Más de ${formatear(desde)}${u}`
            : `${formatear(enteros ? piso! : desde)} a ${formatear(hasta)}${u}`
      tramos.push({
        id: `${desde ?? ''}-${hasta ?? ''}`,
        etiqueta,
        // El filtro es inclusivo: «más de 25» se pide como >= 25,0001.
        min: desde === null ? null : enteros ? desde + 1 : desde + 1e-6,
        max: hasta,
        cantidad,
      })
    }
    desde = hasta
  }
  return tramos.length >= 2 ? tramos : []
}

/**
 * Cómo se dice un rango ya puesto, para la ficha de arriba. Se arma del rango
 * mismo y no del tramo: al elegirlo, las facetas se recalculan sobre los
 * productos que quedaron y los tramos nuevos ya no son los de antes.
 */
export function etiquetaDeRango(rango: { min: number | null; max: number | null }, unidad: string | null): string {
  const u = unidad ? ` ${unidad}` : ''
  const { min, max } = rango
  if (min === null) return max === null ? '' : `Hasta ${formatear(max)}${u}`
  // Los tramos piden «más de 25» como >= 26 (enteros) o >= 25,000001.
  const entero = Number.isInteger(min)
  const anterior = entero ? min - 1 : Math.round(min * 1000) / 1000
  if (max === null) return `Más de ${formatear(anterior)}${u}`
  return `${formatear(entero ? min : anterior)} a ${formatear(max)}${u}`
}

/** El tramo que coincide con un rango puesto (para marcarlo elegido). */
export function tramoActivo(tramos: readonly Tramo[], rango: { min: number | null; max: number | null } | undefined): Tramo | undefined {
  if (!rango) return undefined
  return tramos.find((t) => t.min === rango.min && t.max === rango.max)
}

/**
 * El encastre dicho como lo diría una persona: «1/4 HEX» → «1/4" hexagonal»,
 * «1/2 SQ» → «1/2" cuadrado». El valor guardado no cambia: es la etiqueta.
 */
export function etiquetaDeEncastre(valor: string): string {
  const m = valor.trim().match(/^(\S+)\s+(HEX|SQ)$/i)
  if (!m) return valor
  return `${m[1]}" ${m[2]!.toUpperCase() === 'HEX' ? 'hexagonal' : 'cuadrado'}`
}
