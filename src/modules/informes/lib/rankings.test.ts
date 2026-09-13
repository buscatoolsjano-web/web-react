import { describe, expect, it } from 'vitest'
import { armarActividad } from './actividad'
import { archivoRanking, enlaceFicha, esAtipica, medidasPosibles, monedasDisponibles, normalizarParametros } from './rankings'
import type { FilaActividad, ParametrosRanking } from '../types'

const r = (periodo: string, desde: string, hasta: string): FilaActividad => ({ periodo, tipo: null, mes: desde, desde, hasta, moneda: null, documentos: 0, importe: 0, en_revision: 0 })
const f = (periodo: string, tipo: string, mes: string, moneda: string | null, documentos: number): FilaActividad => ({ periodo, tipo, mes, desde: null, hasta: null, moneda, documentos, importe: 1, en_revision: 0 })

const actividad = armarActividad([
  r('rango_actual', '2026-09-01', '2026-09-13'),
  r('rango_anterior', '2026-08-01', '2026-08-13'),
  f('actual', 'entregas', '2026-09-01', 'USD', 2),
  f('actual', 'entregas', '2026-09-01', null, 15),
  f('anterior', 'entregas', '2026-08-01', 'EUR', 1),
  f('mes', 'entregas', '2026-09-01', 'USD', 2),
  f('mes', 'entregas', '2026-09-01', null, 15),
  f('mes', 'entregas', '2026-03-01', 'ARS', 4),
  f('mes', 'pedidos', '2026-03-01', 'ARS', 1),
])

describe('monedas del ranking: separadas, SIN MONEDA incluida, nunca «todas»', () => {
  it('mes: sólo las que tienen documentos en el tramo actual (EUR del anterior no)', () => {
    expect(monedasDisponibles(actividad, 'entregado', 'mes')).toEqual(['USD', 'SIN MONEDA'])
  })

  it('12 meses: las de la serie', () => {
    expect(monedasDisponibles(actividad, 'entregado', '12m')).toEqual(['ARS', 'USD', 'SIN MONEDA'])
    expect(monedasDisponibles(actividad, 'cotizado', '12m')).toEqual([])
  })
})

describe('combinaciones válidas', () => {
  it('clientes sólo importe; productos entregados sólo cantidad', () => {
    expect(medidasPosibles('clientes', 'pedido')).toEqual(['importe'])
    expect(medidasPosibles('productos', 'entregado')).toEqual(['cantidad'])
    expect(medidasPosibles('productos', 'cotizado')).toEqual(['importe', 'cantidad'])
  })

  it('normaliza: medida posible, moneda existente o la primera; cantidad sin moneda', () => {
    const base: ParametrosRanking = { dimension: 'productos', fuente: 'entregado', medida: 'importe', periodo: 'mes', moneda: 'EUR' }
    expect(normalizarParametros(base, ['USD', 'SIN MONEDA'])).toEqual({ ...base, medida: 'cantidad', moneda: null })
    const cli: ParametrosRanking = { dimension: 'clientes', fuente: 'entregado', medida: 'cantidad', periodo: 'mes', moneda: 'EUR' }
    expect(normalizarParametros(cli, ['USD', 'SIN MONEDA'])).toEqual({ ...cli, medida: 'importe', moneda: 'USD' })
    expect(normalizarParametros({ ...cli, moneda: 'SIN MONEDA' }, ['USD', 'SIN MONEDA']).moneda).toBe('SIN MONEDA')
    expect(normalizarParametros(cli, []).moneda).toBeNull()
  })
})

describe('presentación', () => {
  it('atípico: sólo con líneas atípicas; no por cantidad alta sola', () => {
    expect(esAtipica({ lineas_atipicas: 2 })).toBe(true)
    expect(esAtipica({ lineas_atipicas: 0 })).toBe(false)
    expect(esAtipica({ lineas_atipicas: null })).toBe(false)
  })

  it('enlaces por id real; línea sin producto, sin enlace', () => {
    expect(enlaceFicha({ cliente_id: 'c-1', producto_id: null, codigo: null, vinculado: true })).toBe('/clientes/c-1')
    expect(enlaceFicha({ cliente_id: null, producto_id: 'p-1', codigo: 'SP.VPTX15/50', vinculado: true })).toBe('/catalogo/SP.VPTX15%2F50')
    expect(enlaceFicha({ cliente_id: null, producto_id: null, codigo: 'SER00006', vinculado: false })).toBeNull()
  })

  it('nombre de archivo', () => {
    expect(archivoRanking({ dimension: 'clientes', fuente: 'entregado', medida: 'importe', periodo: 'mes', moneda: 'USD' }, '2026-09')).toBe('informe-clientes-entregado-USD-mes-2026-09.csv')
    expect(archivoRanking({ dimension: 'productos', fuente: 'pedido', medida: 'cantidad', periodo: '12m', moneda: null }, '2026-09')).toBe('informe-productos-pedido-cantidad-12m-2026-09.csv')
  })
})
