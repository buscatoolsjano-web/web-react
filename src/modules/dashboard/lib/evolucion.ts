import type { Moneda, SerieActividad, TipoActividad } from '@/modules/informes/types'

/**
 * La geometría y la escala del gráfico de evolución (Fase 62).
 *
 * Todo lo que se puede decidir sin dibujar vive acá, porque es lo que se puede
 * verificar: dónde van las barras, hasta dónde llega el eje y qué moneda se
 * mira. El componente se queda con pintar.
 */

/**
 * EL ORDEN DE LAS SERIES ES FIJO, Y ESO NO ES COSMÉTICO.
 *
 * El color sigue a la serie, nunca a su posición: apagar «Pedidos» no puede
 * repintar a las otras dos. Si el color saliera del índice del array visible,
 * «Entregado» pasaría de verde a naranja al ocultar la de arriba, y el lector
 * tendría que volver a leer la leyenda cada vez que toca un botón.
 *
 * Son el embudo comercial en su orden natural: se cotiza, se pide, se entrega.
 */
export const SERIES: readonly { tipo: TipoActividad; slot: 1 | 2 | 3 }[] = [
  { tipo: 'cotizaciones', slot: 1 },
  { tipo: 'pedidos', slot: 2 },
  { tipo: 'entregas', slot: 3 },
]

/** El punto de una serie en un mes. */
export interface PuntoSerie {
  mes: string
  importe: number
  documentos: number
}

// ── La escala vertical ──────────────────────────────────────────────────────

/**
 * Un paso «redondo»: 1, 2, 2,5 o 5 por una potencia de diez.
 *
 * Sin esto el eje diría 133.885,22 / 267.770,44 / … Las marcas del eje llevan
 * los valores que no se etiquetan uno por uno, así que tienen que poder
 * leerse de un vistazo.
 */
function pasoRedondo(bruto: number): number {
  if (!Number.isFinite(bruto) || bruto <= 0) return 1
  const exponente = Math.floor(Math.log10(bruto))
  const base = 10 ** exponente
  const n = bruto / base
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return m * base
}

export interface EscalaY {
  /** Hasta dónde llega el eje. Siempre >= al mayor valor. */
  tope: number
  /** Los valores de las líneas de referencia, de 0 al tope. */
  marcas: number[]
}

/**
 * La escala del eje: de CERO al primer número redondo por encima del máximo.
 *
 * Arranca en cero siempre. Un eje cortado hace que una diferencia del 3 %
 * parezca del 300 %, y en un gráfico de importes eso no es un detalle de
 * estilo: es decir otra cosa.
 */
export function escalaY(maximo: number, divisiones = 4): EscalaY {
  if (!Number.isFinite(maximo) || maximo <= 0) return { tope: 0, marcas: [] }
  const paso = pasoRedondo(maximo / divisiones)
  const pasos = Math.ceil(maximo / paso)
  // Multiplicar por el índice, no ir sumando: acumular `paso` doce veces
  // arrastra el error de coma flotante y la última marca queda en 999.999,97.
  return { tope: paso * pasos, marcas: Array.from({ length: pasos + 1 }, (_, i) => paso * i) }
}

// ── Qué moneda se mira ──────────────────────────────────────────────────────

/**
 * Las monedas de las series VISIBLES, juntas.
 *
 * Nunca se mezclan dos monedas en el mismo gráfico —una barra que sume pesos
 * con dólares no es más alta, es falsa— pero sí se comparan tres series en la
 * MISMA moneda, que es lo que se pidió. Por eso la lista es la unión: la
 * moneda tiene que existir para poder elegirla aunque sólo una serie la tenga.
 */
export function monedasDisponibles(series: readonly SerieActividad[]): Moneda[] {
  const vistas = new Set<Moneda>()
  for (const s of series) for (const m of s.monedas) vistas.add(m)
  return [...vistas].sort()
}

/**
 * Cuál se mira si nadie eligió: la que más documentos movió entre las visibles.
 *
 * Se cuenta sobre las series que se están mirando, no sobre una sola: si el
 * lector prendió las tres, la moneda por defecto tiene que ser la del conjunto.
 */
export function monedaPrincipal(series: readonly SerieActividad[]): Moneda | null {
  const cuenta = new Map<Moneda, number>()
  for (const s of series) {
    for (const mes of s.meses) {
      for (const [moneda, cifra] of Object.entries(mes.porMoneda)) {
        cuenta.set(moneda, (cuenta.get(moneda) ?? 0) + cifra.documentos)
      }
    }
  }
  const ordenadas = [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return ordenadas[0]?.[0] ?? monedasDisponibles(series)[0] ?? null
}

/** El mayor importe entre todas las series visibles: es lo que fija la escala. */
export function maximoDe(series: readonly (readonly PuntoSerie[])[]): number {
  let max = 0
  for (const puntos of series) for (const p of puntos) if (p.importe > max) max = p.importe
  return max
}

/**
 * Apagar una serie, salvo que sea la última encendida.
 *
 * Un gráfico sin ninguna serie no dice nada y además deja al lector sin forma
 * obvia de volver: el último botón encendido no se apaga.
 */
export function alternarSerie(
  visibles: readonly TipoActividad[],
  tipo: TipoActividad,
): TipoActividad[] {
  if (!visibles.includes(tipo)) {
    // Se vuelve a poner en el orden fijo, no al final: el orden de las barras
    // dentro del grupo no puede depender del orden en que se prendieron.
    return SERIES.filter((s) => s.tipo === tipo || visibles.includes(s.tipo)).map((s) => s.tipo)
  }
  if (visibles.length === 1) return [...visibles]
  return visibles.filter((t) => t !== tipo)
}
