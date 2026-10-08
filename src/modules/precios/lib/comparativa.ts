/**
 * La comparativa entre dos listas de precios (Fase 49).
 *
 * Lógica pura, sin red: vive en `lib/` para que su test corra sin `.env` y sin
 * arrastrar el cliente de Supabase.
 *
 * El % lo calcula la base —en la vista `price_list_changes`— para que la misma
 * cuenta valga para la pantalla, para un informe y para cualquiera que
 * consulte. Acá se resume y se ordena, que es lo que necesita una pantalla y
 * no tiene por qué estar en SQL.
 */

/** Qué le pasó a un renglón entre una lista y la anterior. */
export type Movimiento = 'subio' | 'bajo' | 'igual' | 'entro' | 'salio' | 'sin dato' | 'primera lista'

export interface CambioDePrecio {
  reference: string
  description: string | null
  productId: string | null
  precio: number | null
  precioAnterior: number | null
  /** Null cuando no hay con qué comparar (entró, o la anterior no tenía precio). */
  porcentaje: number | null
  movimiento: Movimiento
}

export interface ResumenComparativa {
  total: number
  subieron: number
  bajaron: number
  iguales: number
  entraron: number
  salieron: number
  /**
   * La MEDIANA del % de los que cambiaron, no el promedio.
   *
   * Un promedio se lo come un solo renglón mal cargado: en este catálogo hay
   * precios 100 veces por debajo de su familia, y uno solo de ésos convierte
   * un aumento del 12 % en uno del 400 %. La mediana aguanta eso.
   */
  medianaPct: number | null
  /** El promedio, al lado, porque la diferencia entre los dos ES información. */
  promedioPct: number | null
  /** Los que más se movieron, para mirar primero. */
  mayoresSubas: CambioDePrecio[]
  mayoresBajas: CambioDePrecio[]
}

/** Cuántos decimales tiene sentido mostrar en un %. */
const redondear = (n: number) => Math.round(n * 100) / 100

export function medianaDe(valores: readonly number[]): number | null {
  if (valores.length === 0) return null
  const orden = [...valores].sort((a, b) => a - b)
  const medio = orden.length >> 1
  const v = orden.length % 2 === 1 ? orden[medio]! : (orden[medio - 1]! + orden[medio]!) / 2
  return redondear(v)
}

export function resumir(cambios: readonly CambioDePrecio[], cuantosDestacar = 5): ResumenComparativa {
  const conPct = cambios.filter((c) => c.porcentaje !== null && c.movimiento !== 'igual')
  const pcts = conPct.map((c) => c.porcentaje!)
  const suma = pcts.reduce((a, b) => a + b, 0)

  const porPct = [...conPct].sort((a, b) => b.porcentaje! - a.porcentaje!)

  return {
    total: cambios.length,
    subieron: cambios.filter((c) => c.movimiento === 'subio').length,
    bajaron: cambios.filter((c) => c.movimiento === 'bajo').length,
    iguales: cambios.filter((c) => c.movimiento === 'igual').length,
    entraron: cambios.filter((c) => c.movimiento === 'entro').length,
    salieron: cambios.filter((c) => c.movimiento === 'salio').length,
    medianaPct: medianaDe(pcts),
    promedioPct: pcts.length === 0 ? null : redondear(suma / pcts.length),
    mayoresSubas: porPct.filter((c) => c.porcentaje! > 0).slice(0, cuantosDestacar),
    mayoresBajas: porPct.filter((c) => c.porcentaje! < 0).slice(-cuantosDestacar).reverse(),
  }
}

/**
 * «+12,4 %», «−3,1 %», «—».
 *
 * Con el signo SIEMPRE, incluso en el aumento: un «12,4 %» suelto no dice si
 * subió o bajó, y es justo lo que se está preguntando. El menos es el menos
 * tipográfico (−), no un guion.
 */
export function formatearPct(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '—'
  const signo = pct > 0 ? '+' : pct < 0 ? '−' : ''
  const n = Math.abs(pct).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${signo}${n} %`
}

/** El tono con el que se pinta un movimiento. Subir un costo NO es bueno. */
export function tonoDe(movimiento: Movimiento): 'sube' | 'baja' | 'neutro' | 'nuevo' {
  switch (movimiento) {
    case 'subio':
      return 'sube'
    case 'bajo':
      return 'baja'
    case 'entro':
    case 'salio':
      return 'nuevo'
    default:
      return 'neutro'
  }
}

/** Lo que se lee en la columna «Movimiento». */
export const ETIQUETA: Record<Movimiento, string> = {
  subio: 'Subió',
  bajo: 'Bajó',
  igual: 'Sin cambio',
  entro: 'Nuevo',
  salio: 'Ya no está',
  'sin dato': 'Sin dato',
  'primera lista': 'Primera lista',
}

/**
 * Los cambios que vale la pena mirar primero.
 *
 * Lo que entró y lo que salió va arriba aunque no tenga %: son las decisiones
 * —un producto nuevo que cotizar, uno que dejó de existir— y ordenados por
 * porcentaje quedarían al final, donde nadie llega.
 */
export function ordenarParaMirar(cambios: readonly CambioDePrecio[]): CambioDePrecio[] {
  const rango = (c: CambioDePrecio) =>
    c.movimiento === 'entro' || c.movimiento === 'salio' ? 0 : 1
  return [...cambios].sort((a, b) => {
    const ra = rango(a), rb = rango(b)
    if (ra !== rb) return ra - rb
    const pa = Math.abs(a.porcentaje ?? 0), pb = Math.abs(b.porcentaje ?? 0)
    if (pa !== pb) return pb - pa
    return a.reference.localeCompare(b.reference, 'es')
  })
}
