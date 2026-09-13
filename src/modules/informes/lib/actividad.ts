import {
  SIN_MONEDA,
  type ActividadComercial,
  type Cifra,
  type FilaActividad,
  type KpiActividad,
  type MesSerie,
  type Moneda,
  type SerieActividad,
  type TipoActividad,
  type Tramo,
} from '../types'

/**
 * Arma el informe a partir de las filas del servidor.
 *
 * El servidor ya agregó: acá sólo se ordena, se completan los meses sin
 * documentos y se calcula la variación. Ninguna moneda se convierte ni se
 * suma con otra.
 */

/** Orden de las tarjetas: lo vendido (entregado) primero. */
export const TIPOS: readonly TipoActividad[] = ['entregas', 'pedidos', 'cotizaciones']

export const ETIQUETA_TIPO: Record<TipoActividad, { titulo: string; documento: [string, string] }> = {
  entregas: { titulo: 'Vendido (entregado)', documento: ['remito', 'remitos'] },
  pedidos: { titulo: 'Pedidos confirmados', documento: ['pedido', 'pedidos'] },
  cotizaciones: { titulo: 'Cotizado', documento: ['cotización', 'cotizaciones'] },
}

const PRIORIDAD_MONEDA: Record<string, number> = { ARS: 0, USD: 1, EUR: 2 }

/** ARS, USD, EUR, cualquier otra por código, y SIN MONEDA al final. */
export function ordenarMonedas(monedas: Iterable<Moneda>): Moneda[] {
  return [...new Set(monedas)].sort((a, b) => {
    if (a === SIN_MONEDA) return 1
    if (b === SIN_MONEDA) return -1
    const pa = PRIORIDAD_MONEDA[a] ?? 10
    const pb = PRIORIDAD_MONEDA[b] ?? 10
    return pa !== pb ? pa - pb : a.localeCompare(b)
  })
}

const CERO: Cifra = { documentos: 0, importe: 0, enRevision: 0 }

function cifra(f: FilaActividad): Cifra {
  return { documentos: Number(f.documentos), importe: Number(f.importe), enRevision: Number(f.en_revision) }
}

function esTipo(t: string | null): t is TipoActividad {
  return t === 'entregas' || t === 'pedidos' || t === 'cotizaciones'
}

/** `YYYY-MM-01` de los 12 meses que terminan en `mesFinal`. Sin `Date`: sin zona horaria. */
export function mesesDeLaSerie(mesFinal: string): string[] {
  const y = Number(mesFinal.slice(0, 4))
  const m = Number(mesFinal.slice(5, 7))
  return Array.from({ length: 12 }, (_, i) => {
    const total = y * 12 + (m - 1) - (11 - i)
    const yy = Math.floor(total / 12)
    const mm = (total % 12) + 1
    return `${yy}-${String(mm).padStart(2, '0')}-01`
  })
}

/** `null` cuando no hay base para comparar: nunca un +100 % inventado. */
export function variacion(actual: number, anterior: number): number | null {
  if (anterior === 0) return null
  return ((actual - anterior) / Math.abs(anterior)) * 100
}

function tramo(filas: FilaActividad[], periodo: 'rango_actual' | 'rango_anterior'): Tramo | null {
  const f = filas.find((x) => x.periodo === periodo)
  if (!f?.desde || !f.hasta) return null
  return { desde: f.desde, hasta: f.hasta, parcial: !esFinDeMes(f.hasta) }
}

function esFinDeMes(fecha: string): boolean {
  const y = Number(fecha.slice(0, 4))
  const m = Number(fecha.slice(5, 7))
  const d = Number(fecha.slice(8, 10))
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d === ultimo
}

export function armarActividad(filas: FilaActividad[]): ActividadComercial {
  const actual = tramo(filas, 'rango_actual')
  const anterior = tramo(filas, 'rango_anterior')
  if (!actual || !anterior) throw new Error('El informe no trajo los períodos')

  const kpis: KpiActividad[] = TIPOS.map((tipo) => {
    const act = filas.filter((f) => f.periodo === 'actual' && f.tipo === tipo)
    const ant = filas.filter((f) => f.periodo === 'anterior' && f.tipo === tipo)
    const monedas = ordenarMonedas([...act, ...ant].map((f) => f.moneda ?? SIN_MONEDA))
    return {
      tipo,
      documentosActual: act.reduce((s, f) => s + Number(f.documentos), 0),
      documentosAnterior: ant.reduce((s, f) => s + Number(f.documentos), 0),
      enRevisionActual: act.reduce((s, f) => s + Number(f.en_revision), 0),
      monedas: monedas.map((moneda) => {
        const a = act.find((f) => (f.moneda ?? SIN_MONEDA) === moneda)
        const p = ant.find((f) => (f.moneda ?? SIN_MONEDA) === moneda)
        const ca = a ? cifra(a) : CERO
        const cp = p ? cifra(p) : CERO
        return { moneda, actual: ca, anterior: cp, variacion: variacion(ca.importe, cp.importe) }
      }),
    }
  })

  const meses = mesesDeLaSerie(actual.desde)
  const series: SerieActividad[] = TIPOS.map((tipo) => {
    const delTipo = filas.filter((f) => f.periodo === 'mes' && esTipo(f.tipo) && f.tipo === tipo)
    const monedas = ordenarMonedas(delTipo.map((f) => f.moneda ?? SIN_MONEDA))
    const porMes: MesSerie[] = meses.map((mes) => {
      const porMoneda: Record<Moneda, Cifra> = {}
      for (const moneda of monedas) {
        const f = delTipo.find((x) => x.mes === mes && (x.moneda ?? SIN_MONEDA) === moneda)
        porMoneda[moneda] = f ? cifra(f) : CERO
      }
      return { mes, porMoneda }
    })
    return { tipo, meses: porMes, monedas }
  })

  return { actual, anterior, kpis, series }
}

// ── URL y etiquetas ──────────────────────────────────────────────────────────

/** `?mes=YYYY-MM` válido, o `null` (mes en curso). */
export function leerMes(valor: string | null): string | null {
  if (!valor || !/^\d{4}-(0[1-9]|1[0-2])$/.test(valor)) return null
  return valor
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** `2026-09-01` → `sep 26`. */
export function etiquetaMesCorta(mes: string): string {
  return `${MESES[Number(mes.slice(5, 7)) - 1] ?? '?'} ${mes.slice(2, 4)}`
}

/** `2026-09-01` → `septiembre 2026`. */
export function etiquetaMesLarga(mes: string): string {
  return `${MESES_LARGOS[Number(mes.slice(5, 7)) - 1] ?? '?'} ${mes.slice(0, 4)}`
}

/** Tramo legible: «1–13 sep 2026» o «septiembre 2026». */
export function etiquetaTramo(t: Tramo): string {
  if (!t.parcial) return etiquetaMesLarga(t.desde)
  const mes = MESES[Number(t.desde.slice(5, 7)) - 1] ?? '?'
  return `${Number(t.desde.slice(8, 10))}–${Number(t.hasta.slice(8, 10))} ${mes} ${t.desde.slice(0, 4)}`
}

export function formatearImporte(importe: number): string {
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(importe)
}

export function formatearVariacion(v: number | null): string {
  if (v === null) return 'sin base'
  if (Math.abs(v) < 0.05) return '0 %'
  const n = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Math.abs(v))
  return `${v > 0 ? '+' : '−'}${n} %`
}
