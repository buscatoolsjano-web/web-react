import { describe, expect, it } from 'vitest'
import {
  armarActividad,
  etiquetaMesCorta,
  etiquetaTramo,
  formatearVariacion,
  leerMes,
  mesesDeLaSerie,
  ordenarMonedas,
  variacion,
} from './actividad'
import { puedeVerInformes } from './permisos'
import type { FilaActividad } from '../types'

const rango = (periodo: 'rango_actual' | 'rango_anterior', desde: string, hasta: string): FilaActividad => ({
  periodo, tipo: null, mes: desde, desde, hasta, moneda: null, documentos: 0, importe: 0, en_revision: 0,
})
const fila = (periodo: string, tipo: string, mes: string, moneda: string | null, documentos: number, importe: number, en_revision = 0): FilaActividad => ({
  periodo, tipo, mes, desde: null, hasta: null, moneda, documentos, importe, en_revision,
})

const BASE: FilaActividad[] = [
  rango('rango_actual', '2026-09-01', '2026-09-13'),
  rango('rango_anterior', '2026-08-01', '2026-08-13'),
  fila('actual', 'entregas', '2026-09-01', 'USD', 2, 1300.01, 2),
  fila('actual', 'entregas', '2026-09-01', 'ARS', 2, 1000265.03, 2),
  fila('actual', 'entregas', '2026-09-01', 'SIN MONEDA', 15, 12996570.72, 15),
  fila('anterior', 'entregas', '2026-08-01', 'USD', 3, 650),
  fila('mes', 'entregas', '2026-09-01', 'USD', 2, 1300.01, 2),
  fila('mes', 'entregas', '2026-09-01', 'SIN MONEDA', 15, 12996570.72, 15),
  fila('mes', 'entregas', '2025-10-01', 'EUR', 1, 20),
  fila('mes', 'pedidos', '2026-08-01', 'ARS', 1, 7),
]

describe('armarActividad', () => {
  const a = armarActividad(BASE)

  it('tarjetas en orden: vendido (entregado), pedidos, cotizado', () => {
    expect(a.kpis.map((k) => k.tipo)).toEqual(['entregas', 'pedidos', 'cotizaciones'])
  })

  it('cada moneda por separado, SIN MONEDA al final, nada sumado entre monedas', () => {
    const ent = a.kpis[0]!
    expect(ent.monedas.map((m) => m.moneda)).toEqual(['ARS', 'USD', 'SIN MONEDA'])
    expect(ent.monedas.find((m) => m.moneda === 'SIN MONEDA')!.actual).toEqual({ documentos: 15, importe: 12996570.72, enRevision: 15 })
    expect(ent.monedas.find((m) => m.moneda === 'USD')!.actual.importe).toBe(1300.01)
    expect(ent.documentosActual).toBe(19)
    expect(ent.enRevisionActual).toBe(19)
  })

  it('variación contra el tramo anterior; sin base → null, no +100 %', () => {
    const ent = a.kpis[0]!
    expect(ent.monedas.find((m) => m.moneda === 'USD')!.variacion).toBeCloseTo(100.0015, 3)
    expect(ent.monedas.find((m) => m.moneda === 'ARS')!.variacion).toBeNull()
  })

  it('una moneda que sólo estuvo en el período anterior aparece con cero actual', () => {
    const b = armarActividad([...BASE, fila('anterior', 'pedidos', '2026-08-01', 'EUR', 1, 5)])
    const eur = b.kpis[1]!.monedas.find((m) => m.moneda === 'EUR')!
    expect(eur.actual).toEqual({ documentos: 0, importe: 0, enRevision: 0 })
    expect(eur.variacion).toBe(-100)
  })

  it('serie: los 12 meses que terminan en el mes pedido, con ceros donde no hubo documentos', () => {
    const ent = a.series[0]!
    expect(ent.meses.map((m) => m.mes)).toEqual(mesesDeLaSerie('2026-09-01'))
    expect(ent.monedas).toEqual(['USD', 'EUR', 'SIN MONEDA'])
    expect(ent.meses[0]!.mes).toBe('2025-10-01')
    expect(ent.meses[0]!.porMoneda['EUR']).toEqual({ documentos: 1, importe: 20, enRevision: 0 })
    expect(ent.meses[5]!.porMoneda['USD']).toEqual({ documentos: 0, importe: 0, enRevision: 0 })
    expect(a.series[2]!.monedas).toEqual([])
  })

  it('tramo parcial en el mes en curso; completo en un mes cerrado', () => {
    expect(a.actual).toEqual({ desde: '2026-09-01', hasta: '2026-09-13', parcial: true })
    const cerrado = armarActividad([rango('rango_actual', '2026-02-01', '2026-02-28'), rango('rango_anterior', '2026-01-01', '2026-01-31')])
    expect(cerrado.actual.parcial).toBe(false)
    expect(cerrado.anterior.parcial).toBe(false)
  })

  it('sin los períodos del servidor, no inventa fechas', () => {
    expect(() => armarActividad([])).toThrow()
  })
})

describe('meses y etiquetas, sin zona horaria', () => {
  it('la serie cruza el año', () => {
    expect(mesesDeLaSerie('2026-03-01')).toEqual([
      '2025-04-01', '2025-05-01', '2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01',
      '2025-10-01', '2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01',
    ])
  })

  it('el día 1 es de su mes', () => {
    expect(etiquetaMesCorta('2026-09-01')).toBe('sep 26')
    expect(etiquetaTramo({ desde: '2026-09-01', hasta: '2026-09-13', parcial: true })).toBe('1–13 sep 2026')
    expect(etiquetaTramo({ desde: '2026-08-01', hasta: '2026-08-31', parcial: false })).toBe('agosto 2026')
  })

  it('?mes= sólo acepta YYYY-MM', () => {
    expect(leerMes('2026-08')).toBe('2026-08')
    for (const malo of ['2026-13', '2026-8', '08-2026', 'x', '', null]) expect(leerMes(malo)).toBeNull()
  })
})

describe('monedas y variación', () => {
  it('ARS, USD, EUR, otras por código, SIN MONEDA al final', () => {
    expect(ordenarMonedas(['SIN MONEDA', 'BRL', 'EUR', 'USD', 'ARS', 'USD'])).toEqual(['ARS', 'USD', 'EUR', 'BRL', 'SIN MONEDA'])
  })

  it('formato de la variación', () => {
    expect(variacion(10, 0)).toBeNull()
    expect(formatearVariacion(null)).toBe('sin base')
    expect(formatearVariacion(12.34)).toBe('+12,3 %')
    expect(formatearVariacion(-50)).toBe('−50 %')
    expect(formatearVariacion(0.01)).toBe('0 %')
  })
})

describe('permisos', () => {
  it('sólo admin y employee', () => {
    expect(['admin', 'employee'].every(puedeVerInformes)).toBe(true)
    for (const r of ['salesperson', 'technician', 'customer', 'distributor', '', null, undefined]) expect(puedeVerInformes(r)).toBe(false)
  })
})
