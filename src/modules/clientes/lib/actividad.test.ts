import { describe, expect, it } from 'vitest'
import { etiquetaDeMes, mesesHasta, monedasDe, serieDe } from './actividad'
import type { ActividadMensual } from '../types'

const fila = (
  mes: string,
  tipo: ActividadMensual['tipo'],
  moneda: string | null,
  documentos: number,
  importe: number,
): ActividadMensual => ({ mes, tipo, moneda, documentos, importe })

describe('mesesHasta', () => {
  it('devuelve n meses terminando en el mes dado', () => {
    const m = mesesHasta(new Date(Date.UTC(2026, 8, 10)), 12)
    expect(m).toHaveLength(12)
    expect(m[0]).toBe('2025-10-01')
    expect(m[11]).toBe('2026-09-01')
  })

  it('cruza el año hacia atrás sin corrimientos', () => {
    const m = mesesHasta(new Date(Date.UTC(2026, 0, 15)), 3)
    expect(m).toEqual(['2025-11-01', '2025-12-01', '2026-01-01'])
  })

  it('un primero de mes no se cae al mes anterior por la zona horaria', () => {
    // El caso que rompe si se usa `new Date(a, m, 1)`: en UTC−3 el 1 a las 00
    // local es el 30 o 31 anterior en UTC.
    const m = mesesHasta(new Date(Date.UTC(2026, 2, 1)), 1)
    expect(m).toEqual(['2026-03-01'])
  })
})

describe('serieDe', () => {
  const meses = ['2026-01-01', '2026-02-01', '2026-03-01']
  const filas = [
    fila('2026-01-01', 'cotizacion', 'USD', 3, 1000),
    fila('2026-01-01', 'cotizacion', 'ARS', 2, 500000),
    fila('2026-01-01', 'pedido', 'USD', 1, 800),
    fila('2026-03-01', 'cotizacion', 'USD', 5, 2500),
  ]

  it('una serie es UN tipo y UNA moneda', () => {
    const s = serieDe(filas, { tipo: 'cotizacion', moneda: 'USD', medida: 'documentos', meses })
    expect(s.map((p) => p.valor)).toEqual([3, 0, 5])
  })

  it('no mezcla monedas', () => {
    const usd = serieDe(filas, { tipo: 'cotizacion', moneda: 'USD', medida: 'documentos', meses })
    const ars = serieDe(filas, { tipo: 'cotizacion', moneda: 'ARS', medida: 'documentos', meses })
    expect(usd[0]!.valor).toBe(3)
    expect(ars[0]!.valor).toBe(2)
    // Lo que NO puede pasar: que una serie valga 5 en enero.
    expect(usd[0]!.valor + ars[0]!.valor).toBe(5)
    expect(usd.some((p) => p.valor === 5 && p.mes === '2026-01-01')).toBe(false)
  })

  it('no mezcla tipos de documento', () => {
    const cot = serieDe(filas, { tipo: 'cotizacion', moneda: 'USD', medida: 'documentos', meses })
    const ped = serieDe(filas, { tipo: 'pedido', moneda: 'USD', medida: 'documentos', meses })
    expect(cot[0]!.valor).toBe(3)
    expect(ped[0]!.valor).toBe(1)
  })

  it('rellena los meses sin documentos con cero', () => {
    const s = serieDe(filas, { tipo: 'cotizacion', moneda: 'USD', medida: 'documentos', meses })
    expect(s[1]).toEqual({ mes: '2026-02-01', valor: 0 })
  })

  it('mide importe cuando se le pide', () => {
    const s = serieDe(filas, { tipo: 'cotizacion', moneda: 'USD', medida: 'importe', meses })
    expect(s.map((p) => p.valor)).toEqual([1000, 0, 2500])
  })

  it('los documentos sin moneda son su propia serie', () => {
    const conNulos = [...filas, fila('2026-02-01', 'cotizacion', null, 4, 99)]
    const s = serieDe(conNulos, { tipo: 'cotizacion', moneda: null, medida: 'documentos', meses })
    expect(s.map((p) => p.valor)).toEqual([0, 4, 0])
  })
})

describe('monedasDe', () => {
  it('ordena por cantidad de documentos', () => {
    const filas = [
      fila('2026-01-01', 'cotizacion', 'ARS', 2, 0),
      fila('2026-01-01', 'cotizacion', 'USD', 9, 0),
      fila('2026-01-01', 'cotizacion', 'EUR', 1, 0),
    ]
    expect(monedasDe(filas)).toEqual(['USD', 'ARS', 'EUR'])
  })

  it('«sin moneda» va último', () => {
    const filas = [
      fila('2026-01-01', 'cotizacion', null, 50, 0),
      fila('2026-01-01', 'cotizacion', 'USD', 1, 0),
    ]
    expect(monedasDe(filas)).toEqual(['USD', null])
  })

  it('sin filas, ninguna moneda', () => {
    expect(monedasDe([])).toEqual([])
  })
})

describe('etiquetaDeMes', () => {
  it('acorta a mes y año de dos dígitos', () => {
    expect(etiquetaDeMes('2026-01-01')).toBe('ene 26')
    expect(etiquetaDeMes('2025-12-01')).toBe('dic 25')
  })

  it('lo que no es un mes se muestra tal cual', () => {
    expect(etiquetaDeMes('cualquier cosa')).toBe('cualquier cosa')
  })
})
