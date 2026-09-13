import { describe, expect, it } from 'vitest'
import { armarActividad } from './actividad'
import {
  armarPipeline,
  etiquetaDoceMeses,
  formatearTasa,
  resumirCumplimiento,
  tasa,
  ticketsPorMoneda,
  TODAS,
} from './pipeline'
import type { FilaActividad, FilaPipeline } from '../types'

const f = (p: Partial<FilaPipeline> & Pick<FilaPipeline, 'seccion' | 'periodo'>): FilaPipeline => ({
  desde: null, hasta: null, categoria: null, moneda: null, documentos: 0, importe: null,
  convertidas: null, importe_convertido: null, abiertas: null, aceptadas: null, ...p,
})

const RANGOS: FilaPipeline[] = [
  f({ seccion: 'rango_actual', periodo: 'actual', desde: '2026-09-01', hasta: '2026-09-13' }),
  f({ seccion: 'rango_anterior', periodo: 'anterior', desde: '2026-08-01', hasta: '2026-08-13' }),
  f({ seccion: 'rango_12m', periodo: '12m', desde: '2025-10-01', hasta: '2026-09-13' }),
]

// Números reales de Buscatools (2026-09-13), recortados.
const BASE: FilaPipeline[] = [
  ...RANGOS,
  f({ seccion: 'cotizaciones_abiertas', periodo: 'hoy', categoria: 'hasta_30', moneda: 'USD', documentos: 19, importe: 68213.8513, aceptadas: 1 }),
  f({ seccion: 'cotizaciones_abiertas', periodo: 'hoy', categoria: 'mas_90', moneda: 'USD', documentos: 79, importe: 789095.33, aceptadas: 1 }),
  f({ seccion: 'cotizaciones_abiertas', periodo: 'hoy', categoria: 'hasta_30', moneda: 'SIN MONEDA', documentos: 6, importe: 80668.25, aceptadas: 0 }),
  f({ seccion: 'cotizaciones_abiertas', periodo: 'hoy', categoria: '31_90', moneda: 'ARS', documentos: 9, importe: 15544936.93, aceptadas: 0 }),
  f({ seccion: 'conversion', periodo: '12m', moneda: 'USD', documentos: 233, importe: 1362732.0113, convertidas: 109, importe_convertido: 315741.02, abiertas: 124, aceptadas: 111 }),
  f({ seccion: 'conversion', periodo: '12m', moneda: 'ARS', documentos: 48, importe: 60162220.2248, convertidas: 23, importe_convertido: 29309053.03, abiertas: 25, aceptadas: 23 }),
  f({ seccion: 'conversion', periodo: '12m', moneda: TODAS, documentos: 288, convertidas: 132, abiertas: 156, aceptadas: 134 }),
  f({ seccion: 'conversion', periodo: 'actual', moneda: TODAS, documentos: 14, convertidas: 0, abiertas: 14, aceptadas: 1 }),
  f({ seccion: 'conversion', periodo: 'anterior', moneda: TODAS, documentos: 0, convertidas: 0, abiertas: 0, aceptadas: 0 }),
  f({ seccion: 'inconsistencias', periodo: 'todos', categoria: 'moneda_distinta', documentos: 1 }),
  f({ seccion: 'inconsistencias', periodo: 'todos', categoria: 'convertida_desde_borrador', documentos: 0 }),
  f({ seccion: 'cumplimiento', periodo: 'todos', categoria: 'completo', documentos: 112 }),
  f({ seccion: 'cumplimiento', periodo: 'todos', categoria: 'parcial', documentos: 12 }),
  f({ seccion: 'cumplimiento', periodo: 'todos', categoria: 'sin_entrega', documentos: 5 }),
  f({ seccion: 'cumplimiento', periodo: 'todos', categoria: 'sobreentregado', documentos: 2 }),
  f({ seccion: 'cumplimiento', periodo: 'todos', categoria: 'no_consta_entrega', documentos: 21 }),
  f({ seccion: 'cumplimiento', periodo: 'todos', categoria: 'detalle_no_reconstruido', documentos: 14 }),
  f({ seccion: 'cumplimiento', periodo: 'actual', categoria: 'no_consta_entrega', documentos: 12 }),
  f({ seccion: 'pedidos_pendientes', periodo: 'todos', categoria: 'parcial', moneda: 'USD', documentos: 12, importe: 9904.5004 }),
  f({ seccion: 'pedidos_pendientes', periodo: 'todos', categoria: 'sin_entrega', moneda: 'USD', documentos: 3, importe: 1140.65 }),
  f({ seccion: 'pedidos_pendientes', periodo: 'todos', categoria: 'sin_entrega', moneda: 'SIN MONEDA', documentos: 2, importe: 1203.2 }),
]

describe('conversión', () => {
  const p = armarPipeline(BASE)

  it('tasa = convertidas / elegibles, con el denominador a la vista', () => {
    const t = p.conversion['12m'].todas
    expect(t).toMatchObject({ elegibles: 288, convertidas: 132, abiertas: 156, aceptadas: 134 })
    expect(t.tasa).toBeCloseTo(45.833, 3)
    expect(formatearTasa(t.tasa)).toBe('45,8 %')
  })

  it('aceptadas no es convertidas: 134 aceptadas, 132 con pedido', () => {
    expect(p.conversion['12m'].todas.aceptadas).not.toBe(p.conversion['12m'].todas.convertidas)
  })

  it('por moneda, con importes; TODAS sólo cantidades', () => {
    expect(p.conversion['12m'].monedas.map((m) => m.moneda)).toEqual(['ARS', 'USD'])
    expect(p.conversion['12m'].monedas[1]).toMatchObject({ importeElegible: 1362732.0113, importeConvertido: 315741.02 })
    expect(p.conversion['12m'].todas.importeElegible).toBeNull()
    expect(p.conversion['12m'].todas.importeConvertido).toBeNull()
  })

  it('sin elegibles no hay tasa (ni 0 % ni 100 %)', () => {
    expect(p.conversion.anterior.todas.tasa).toBeNull()
    expect(formatearTasa(p.conversion.anterior.todas.tasa)).toBe('—')
    expect(p.conversion.actual.todas.tasa).toBe(0)
    expect(formatearTasa(0)).toBe('0 %')
  })

  it('inconsistencias', () => {
    expect(p.inconsistencias).toEqual({ monedaDistinta: 1, convertidaDesdeBorrador: 0 })
  })
})

describe('cumplimiento', () => {
  const p = armarPipeline(BASE)

  it('las no determinables quedan aparte y NO entran al porcentaje', () => {
    const c = p.cumplimiento.todos
    expect(c.total).toBe(166)
    expect(c.determinables).toBe(131)
    expect(c.noDeterminables).toBe(35)
    // (112 completos + 2 sobreentregados) / 131 determinables
    expect(c.tasaCompletos).toBeCloseTo(87.023, 3)
  })

  it('un tramo con sólo no determinables no dice «0 % completos»', () => {
    const c = p.cumplimiento.actual
    expect(c.noDeterminables).toBe(12)
    expect(c.determinables).toBe(0)
    expect(c.tasaCompletos).toBeNull()
  })

  it('categorías ausentes quedan en cero', () => {
    expect(p.cumplimiento.anterior.porCategoria).toEqual({
      completo: 0, parcial: 0, sin_entrega: 0, sobreentregado: 0,
      no_consta_entrega: 0, detalle_no_reconstruido: 0, sin_lineas: 0,
    })
    expect(resumirCumplimiento(p.cumplimiento.anterior.porCategoria).tasaCompletos).toBeNull()
  })

  it('pendiente por moneda del pedido, SIN MONEDA al final', () => {
    expect(p.pendientes).toEqual([
      { moneda: 'USD', sinEntrega: { documentos: 3, importe: 1140.65 }, parcial: { documentos: 12, importe: 9904.5004 } },
      { moneda: 'SIN MONEDA', sinEntrega: { documentos: 2, importe: 1203.2 }, parcial: { documentos: 0, importe: 0 } },
    ])
  })
})

describe('pipeline', () => {
  const p = armarPipeline(BASE)

  it('cotizaciones abiertas por moneda, con antigüedad y aceptadas sin pedido', () => {
    expect(p.abiertas.map((a) => a.moneda)).toEqual(['ARS', 'USD', 'SIN MONEDA'])
    expect(p.abiertas[1]).toEqual({
      moneda: 'USD', documentos: 98, importe: 857309.1813, aceptadas: 2,
      porAntiguedad: { hasta_30: 19, '31_90': 0, mas_90: 79 },
    })
  })

  it('tramos: 12 meses con su etiqueta; sin períodos no inventa fechas', () => {
    expect(p.tramos['12m']).toEqual({ desde: '2025-10-01', hasta: '2026-09-13', parcial: true })
    expect(etiquetaDoceMeses(p.tramos['12m'])).toBe('oct 25 – sep 26')
    expect(() => armarPipeline([])).toThrow()
  })

  it('tasa sin total → null', () => {
    expect(tasa(0, 0)).toBeNull()
    expect(tasa(1, 4)).toBe(25)
  })
})

describe('ticket promedio', () => {
  const rango = (periodo: string, desde: string, hasta: string): FilaActividad => ({
    periodo, tipo: null, mes: desde, desde, hasta, moneda: null, documentos: 0, importe: 0, en_revision: 0,
  })
  const fa = (periodo: string, tipo: string, mes: string, moneda: string, documentos: number, importe: number): FilaActividad => ({
    periodo, tipo, mes, desde: null, hasta: null, moneda, documentos, importe, en_revision: 0,
  })
  const act = armarActividad([
    rango('rango_actual', '2026-09-01', '2026-09-13'),
    rango('rango_anterior', '2026-08-01', '2026-08-13'),
    fa('actual', 'pedidos', '2026-09-01', 'USD', 4, 1000),
    fa('actual', 'pedidos', '2026-09-01', 'SIN MONEDA', 2, 300),
    fa('mes', 'pedidos', '2026-09-01', 'USD', 4, 1000),
    fa('mes', 'pedidos', '2026-09-01', 'SIN MONEDA', 2, 300),
    fa('mes', 'pedidos', '2026-01-01', 'USD', 1, 5000),
    fa('mes', 'pedidos', '2026-03-01', 'ARS', 3, 900),
  ])

  it('Σ total / documentos, por moneda; nunca un promedio global', () => {
    const t = ticketsPorMoneda(act, 'pedidos')
    expect(t.map((x) => x.moneda)).toEqual(['ARS', 'USD', 'SIN MONEDA'])
    expect(t[1]!.porPeriodo.actual).toEqual({ documentos: 4, importe: 1000, promedio: 250 })
    expect(t[1]!.porPeriodo['12m']).toEqual({ documentos: 5, importe: 6000, promedio: 1200 })
    expect(t[2]!.porPeriodo.actual.promedio).toBe(150)
  })

  it('sin documentos no hay promedio', () => {
    const t = ticketsPorMoneda(act, 'pedidos')
    expect(t[0]!.porPeriodo.actual).toEqual({ documentos: 0, importe: 0, promedio: null })
    expect(t[0]!.porPeriodo.anterior.promedio).toBeNull()
    expect(ticketsPorMoneda(act, 'entregas')).toEqual([])
  })
})
