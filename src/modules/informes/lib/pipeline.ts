import {
  ANTIGUEDADES,
  CATEGORIAS_DETERMINABLES,
  CATEGORIAS_NO_DETERMINABLES,
  PERIODOS_COHORTE,
  type ActividadComercial,
  type Antiguedad,
  type CategoriaCumplimiento,
  type ConversionFila,
  type ConversionPeriodo,
  type CotizacionesAbiertasMoneda,
  type CumplimientoPeriodo,
  type FilaPipeline,
  type PendienteMoneda,
  type PeriodoCohorte,
  type PipelineComercial,
  type TicketCifra,
  type TicketMoneda,
  type Tramo,
} from '../types'
import { etiquetaMesCorta, ordenarMonedas } from './actividad'

/**
 * Arma pipeline, conversión y cumplimiento a partir de las filas de
 * `informe_pipeline_comercial`. El servidor ya contó y sumó: acá se ordena, se
 * completan ceros y se calculan tasas sobre esos agregados. Ninguna moneda se
 * suma con otra.
 */

export const TODAS = 'TODAS'

const TODAS_LAS_CATEGORIAS: readonly CategoriaCumplimiento[] = [...CATEGORIAS_DETERMINABLES, ...CATEGORIAS_NO_DETERMINABLES]

/**
 * Re-sumar agregados del servidor (antigüedades, meses) en punto flotante deja
 * colas como 857309.1812999999: se redondea a los 4 decimales de la base.
 */
export function redondear4(v: number): number {
  return Math.round(v * 10_000) / 10_000
}

/** parte / total × 100, o `null` si no hay total: nunca un 0 % inventado. */
export function tasa(parte: number, total: number): number | null {
  return total > 0 ? (parte / total) * 100 : null
}

function esAntiguedad(v: string | null): v is Antiguedad {
  return v === 'hasta_30' || v === '31_90' || v === 'mas_90'
}

function esCategoria(v: string | null): v is CategoriaCumplimiento {
  return (TODAS_LAS_CATEGORIAS as readonly (string | null)[]).includes(v)
}

function tramoDe(filas: FilaPipeline[], seccion: string): Tramo | null {
  const f = filas.find((x) => x.seccion === seccion)
  if (!f?.desde || !f.hasta) return null
  const y = Number(f.hasta.slice(0, 4))
  const m = Number(f.hasta.slice(5, 7))
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { desde: f.desde, hasta: f.hasta, parcial: Number(f.hasta.slice(8, 10)) !== ultimo }
}

function conversionFila(f: FilaPipeline | undefined, moneda: string): ConversionFila {
  const elegibles = Number(f?.documentos ?? 0)
  const convertidas = Number(f?.convertidas ?? 0)
  const esTodas = moneda === TODAS
  return {
    moneda,
    elegibles,
    convertidas,
    abiertas: Number(f?.abiertas ?? 0),
    aceptadas: Number(f?.aceptadas ?? 0),
    importeElegible: esTodas ? null : Number(f?.importe ?? 0),
    importeConvertido: esTodas ? null : Number(f?.importe_convertido ?? 0),
    tasa: tasa(convertidas, elegibles),
  }
}

export function resumirCumplimiento(porCategoria: Record<CategoriaCumplimiento, number>): CumplimientoPeriodo {
  const determinables = CATEGORIAS_DETERMINABLES.reduce((s, c) => s + porCategoria[c], 0)
  const noDeterminables = CATEGORIAS_NO_DETERMINABLES.reduce((s, c) => s + porCategoria[c], 0)
  return {
    porCategoria,
    total: determinables + noDeterminables,
    determinables,
    noDeterminables,
    tasaCompletos: tasa(porCategoria.completo + porCategoria.sobreentregado, determinables),
  }
}

export function armarPipeline(filas: FilaPipeline[]): PipelineComercial {
  const actual = tramoDe(filas, 'rango_actual')
  const anterior = tramoDe(filas, 'rango_anterior')
  const doce = tramoDe(filas, 'rango_12m')
  if (!actual || !anterior || !doce) throw new Error('El informe no trajo los períodos')

  // Cotizaciones abiertas, hoy.
  const filasAbiertas = filas.filter((f) => f.seccion === 'cotizaciones_abiertas')
  const abiertas: CotizacionesAbiertasMoneda[] = ordenarMonedas(filasAbiertas.map((f) => f.moneda ?? '')).map((moneda) => {
    const deMoneda = filasAbiertas.filter((f) => f.moneda === moneda)
    const porAntiguedad = Object.fromEntries(ANTIGUEDADES.map((a) => [a, 0])) as Record<Antiguedad, number>
    for (const f of deMoneda) if (esAntiguedad(f.categoria)) porAntiguedad[f.categoria] += Number(f.documentos)
    return {
      moneda,
      documentos: deMoneda.reduce((s, f) => s + Number(f.documentos), 0),
      importe: redondear4(deMoneda.reduce((s, f) => s + Number(f.importe ?? 0), 0)),
      aceptadas: deMoneda.reduce((s, f) => s + Number(f.aceptadas ?? 0), 0),
      porAntiguedad,
    }
  })

  // Conversión por cohorte.
  const conversion = Object.fromEntries(
    PERIODOS_COHORTE.map((p): [PeriodoCohorte, ConversionPeriodo] => {
      const deP = filas.filter((f) => f.seccion === 'conversion' && f.periodo === p)
      const monedas = ordenarMonedas(deP.map((f) => f.moneda ?? '').filter((m) => m !== TODAS))
      return [
        p,
        {
          todas: conversionFila(deP.find((f) => f.moneda === TODAS), TODAS),
          monedas: monedas.map((m) => conversionFila(deP.find((f) => f.moneda === m), m)),
        },
      ]
    }),
  ) as Record<PeriodoCohorte, ConversionPeriodo>

  // Cumplimiento por cohorte y de todos los pedidos confirmados.
  const cumplimiento = Object.fromEntries(
    [...PERIODOS_COHORTE, 'todos' as const].map((p) => {
      const porCategoria = Object.fromEntries(TODAS_LAS_CATEGORIAS.map((c) => [c, 0])) as Record<CategoriaCumplimiento, number>
      for (const f of filas) {
        if (f.seccion === 'cumplimiento' && f.periodo === p && esCategoria(f.categoria)) porCategoria[f.categoria] += Number(f.documentos)
      }
      return [p, resumirCumplimiento(porCategoria)]
    }),
  ) as Record<PeriodoCohorte | 'todos', CumplimientoPeriodo>

  // Pedidos pendientes de completar, hoy, por moneda del pedido.
  const filasPend = filas.filter((f) => f.seccion === 'pedidos_pendientes')
  const pendientes: PendienteMoneda[] = ordenarMonedas(filasPend.map((f) => f.moneda ?? '')).map((moneda) => {
    const de = (cat: string) => filasPend.find((f) => f.moneda === moneda && f.categoria === cat)
    const cifra = (f: FilaPipeline | undefined) => ({ documentos: Number(f?.documentos ?? 0), importe: Number(f?.importe ?? 0) })
    return { moneda, sinEntrega: cifra(de('sin_entrega')), parcial: cifra(de('parcial')) }
  })

  const inconsistencia = (c: string) =>
    Number(filas.find((f) => f.seccion === 'inconsistencias' && f.categoria === c)?.documentos ?? 0)

  return {
    tramos: { actual, anterior, '12m': doce },
    abiertas,
    conversion,
    cumplimiento,
    pendientes,
    inconsistencias: {
      monedaDistinta: inconsistencia('moneda_distinta'),
      convertidaDesdeBorrador: inconsistencia('convertida_desde_borrador'),
    },
  }
}

// ── Ticket promedio ─────────────────────────────────────────────────────────

function cifraTicket(documentos: number, importe: number): TicketCifra {
  return { documentos, importe, promedio: documentos > 0 ? importe / documentos : null }
}

/**
 * Ticket promedio = Σ total / cantidad de documentos, por moneda.
 *
 * Sale de los agregados de la Entrega 1 (`informe_actividad_comercial`): el
 * MISMO conjunto de documentos que las tarjetas, sin repetir la regla en otra
 * función. Tramo actual y anterior vienen directos; los 12 meses son la suma
 * de los 12 meses de la serie (que el servidor ya agregó por mes).
 */
export function ticketsPorMoneda(actividad: ActividadComercial, tipo: 'pedidos' | 'entregas'): TicketMoneda[] {
  const kpi = actividad.kpis.find((k) => k.tipo === tipo)
  const serie = actividad.series.find((s) => s.tipo === tipo)
  const monedas = ordenarMonedas([...(kpi?.monedas.map((m) => m.moneda) ?? []), ...(serie?.monedas ?? [])])
  return monedas.map((moneda) => {
    const m = kpi?.monedas.find((x) => x.moneda === moneda)
    let docs12 = 0
    let imp12 = 0
    for (const mes of serie?.meses ?? []) {
      docs12 += mes.porMoneda[moneda]?.documentos ?? 0
      imp12 += mes.porMoneda[moneda]?.importe ?? 0
    }
    return {
      moneda,
      porPeriodo: {
        actual: cifraTicket(m?.actual.documentos ?? 0, m?.actual.importe ?? 0),
        anterior: cifraTicket(m?.anterior.documentos ?? 0, m?.anterior.importe ?? 0),
        '12m': cifraTicket(docs12, redondear4(imp12)),
      },
    }
  })
}

// ── Etiquetas ───────────────────────────────────────────────────────────────

/** «oct 25 – sep 26». */
export function etiquetaDoceMeses(t: Tramo): string {
  return `${etiquetaMesCorta(t.desde)} – ${etiquetaMesCorta(t.hasta)}`
}

/** «12,5 %», «0 %», «—» sin base. */
export function formatearTasa(v: number | null): string {
  if (v === null) return '—'
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(v)} %`
}

export const ETIQUETA_ANTIGUEDAD: Record<Antiguedad, string> = {
  hasta_30: 'hasta 30 días',
  '31_90': '31 a 90 días',
  mas_90: 'más de 90 días',
}

export const ETIQUETA_CATEGORIA: Record<CategoriaCumplimiento, { titulo: string; detalle: string }> = {
  completo: { titulo: 'Completos', detalle: 'cada línea entregada' },
  parcial: { titulo: 'Parciales', detalle: 'alguna línea con pendiente y algo entregado' },
  sin_entrega: { titulo: 'Sin entrega', detalle: 'sin remitos, y el cliente no tiene remitos sueltos' },
  sobreentregado: { titulo: 'Sobreentregados', detalle: 'nada pendiente y alguna línea con más de lo pedido' },
  no_consta_entrega: { titulo: 'No consta entrega', detalle: 'sin remitos enlazados, pero el cliente tiene remitos sin pedido' },
  detalle_no_reconstruido: { titulo: 'Detalle no reconstruido', detalle: 'hay remitos, pero no se sabe a qué líneas corresponden' },
  sin_lineas: { titulo: 'Sin líneas', detalle: 'pedido sin líneas' },
}
