import type { ActividadComercial, KpiActividad, KpiMoneda, Moneda, SerieActividad, TipoActividad, Tramo } from '@/modules/informes/types'

/**
 * Las reglas del Dashboard (Fase 21 · E2).
 *
 * Todo lo que hay acá decide **qué se muestra**, nunca calcula plata: los
 * importes, las comparaciones y la serie de doce meses vienen ya agregados por
 * `informe_actividad_comercial`, que es la misma fuente que usa Informes. Si
 * una regla de negocio cambiara, cambia en el servidor y las dos pantallas la
 * siguen: acá no se vuelve a decidir nada.
 */

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

const partes = (iso: string) => iso.split('-').map(Number) as [number, number, number]

/** `2026-09-01` → `Septiembre 2026`. */
export function mesLargo(iso: string): string {
  const [a, m] = partes(iso)
  const nombre = MESES[(m ?? 1) - 1] ?? iso
  return `${nombre[0]!.toUpperCase()}${nombre.slice(1)} ${a ?? ''}`.trim()
}

/**
 * El tramo, dicho como lo diría una persona: «1–22 de septiembre».
 *
 * Se escribe completo porque el mes en curso **no está terminado** y comparar
 * 22 días contra 31 sería mentir. El servidor ya recorta los dos tramos al
 * mismo largo; acá sólo se muestra cuál es.
 */
export function etiquetaDeTramo(t: Tramo): string {
  const [, mDesde, dDesde] = partes(t.desde)
  const [, mHasta, dHasta] = partes(t.hasta)
  const nombre = (m: number) => MESES[m - 1] ?? ''
  if (mDesde === mHasta) return `${dDesde}–${dHasta} de ${nombre(mHasta)}`
  return `${dDesde} de ${nombre(mDesde)} – ${dHasta} de ${nombre(mHasta)}`
}

/** «Datos al 22 de septiembre», sólo cuando el mes está a medias. */
export function avisoDeMesParcial(t: Tramo): string | null {
  if (!t.parcial) return null
  const [, m, d] = partes(t.hasta)
  return `Datos al ${d} de ${MESES[(m ?? 1) - 1] ?? ''}`
}

export type Direccion = 'sube' | 'baja' | 'igual' | 'sin-base'

/**
 * Hacia dónde se movió una moneda, y con qué palabras decirlo.
 *
 * `variacion` viene en `null` cuando el período anterior fue cero: ahí no hay
 * porcentaje que mostrar. **No es +100 % ni infinito**, es que no hay contra
 * qué comparar, y eso se dice con todas las letras.
 *
 * El color indica DIRECCIÓN, no juicio: que el cotizado baje no convierte a
 * nadie en mal vendedor. Por eso nunca viaja solo —siempre con flecha y
 * texto—, que además es lo que lo hace legible sin ver los colores.
 */
export function direccionDe(m: Pick<KpiMoneda, 'actual' | 'anterior' | 'variacion'>): Direccion {
  if (m.anterior.importe === 0) return 'sin-base'
  if (m.variacion === null) return 'sin-base'
  if (Math.abs(m.variacion) < 0.05) return 'igual'
  return m.variacion > 0 ? 'sube' : 'baja'
}

export const FLECHA: Record<Direccion, string> = {
  sube: '↑',
  baja: '↓',
  igual: '=',
  'sin-base': '',
}

/** El texto de la comparación, completo y sin color. */
export function textoDeVariacion(m: KpiMoneda, anterior: Tramo): string {
  const d = direccionDe(m)
  if (d === 'sin-base') return `Sin base de comparación (${etiquetaDeTramo(anterior)} sin movimiento)`
  if (d === 'igual') return `Igual que ${etiquetaDeTramo(anterior)}`
  const pct = Math.abs(m.variacion!).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${d === 'sube' ? 'Subió' : 'Bajó'} ${pct} % vs ${etiquetaDeTramo(anterior)}`
}

/**
 * Las monedas que se muestran: las que tuvieron movimiento EN EL PERÍODO.
 *
 * No se lista una moneda en cero porque exista en la historia. Hoy el EUR
 * aparece en cotizaciones viejas y no en septiembre: mostrar «EUR 0» sería
 * llenar la tarjeta con una línea que no dice nada.
 */
export function monedasActivas(kpi: KpiActividad | undefined): KpiMoneda[] {
  return (kpi?.monedas ?? []).filter((m) => m.actual.documentos > 0)
}

export function kpiDe(a: ActividadComercial | undefined, tipo: TipoActividad): KpiActividad | undefined {
  return a?.kpis.find((k) => k.tipo === tipo)
}

export interface PuntoSerie {
  /** `YYYY-MM-01` */
  mes: string
  importe: number
  documentos: number
}

/**
 * Los doce meses de UNA serie y UNA moneda, en orden.
 *
 * Nunca se suman dos monedas: una barra que junte ARS con USD no es un número
 * más grande, es un número que no existe.
 */
export function serieDeMoneda(serie: SerieActividad | undefined, moneda: Moneda | null): PuntoSerie[] {
  if (!serie || moneda === null) return []
  return serie.meses.map((m) => {
    const c = m.porMoneda[moneda]
    return { mes: m.mes, importe: c?.importe ?? 0, documentos: c?.documentos ?? 0 }
  })
}

/**
 * Qué moneda se mira primero: la que más documentos tuvo en los doce meses.
 *
 * Es un criterio y no una preferencia: la moneda con más documentos es la que
 * más actividad representa. Si alguien elige otra, manda su elección.
 */
export function monedaPorDefecto(serie: SerieActividad | undefined): Moneda | null {
  if (!serie || serie.monedas.length === 0) return null
  const cuenta = new Map<Moneda, number>()
  for (const m of serie.meses) {
    for (const [moneda, cifra] of Object.entries(m.porMoneda)) {
      cuenta.set(moneda, (cuenta.get(moneda) ?? 0) + cifra.documentos)
    }
  }
  const ordenadas = [...cuenta.entries()].sort((a, b) => b[1] - a[1])
  return ordenadas[0]?.[0] ?? serie.monedas[0] ?? null
}

export const ETIQUETA_SERIE: Record<TipoActividad, { titulo: string; singular: string; plural: string }> = {
  cotizaciones: { titulo: 'Cotizado', singular: 'cotización', plural: 'cotizaciones' },
  pedidos: { titulo: 'Pedidos', singular: 'pedido', plural: 'pedidos' },
  entregas: { titulo: 'Entregado', singular: 'entrega', plural: 'entregas' },
}
