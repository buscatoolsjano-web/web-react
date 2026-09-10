import { describe, expect, it } from 'vitest'
import { totalesPorMoneda } from './totalesPorMoneda'
import type { DocumentoDeCliente } from '../types'

const doc = (
  moneda: string | null,
  total: number | null,
  tipo: DocumentoDeCliente['tipo'] = 'cotizacion',
): DocumentoDeCliente => ({
  id: `${moneda}-${total}-${Math.random()}`,
  tipo,
  numero: 'X',
  fecha: '2026-01-01',
  estado: 'sent',
  moneda,
  total,
})

describe('totalesPorMoneda', () => {
  it('no suma monedas distintas', () => {
    const r = totalesPorMoneda([doc('USD', 100), doc('ARS', 5000), doc('USD', 50)])
    expect(r).toHaveLength(2)
    expect(r.find((t) => t.moneda === 'USD')).toMatchObject({ total: 150, documentos: 2 })
    expect(r.find((t) => t.moneda === 'ARS')).toMatchObject({ total: 5000, documentos: 1 })
    // Lo importante: no existe un total global.
    expect(r.some((t) => t.total === 5150)).toBe(false)
  })

  it('agrupa aparte los documentos sin moneda y los deja últimos', () => {
    const r = totalesPorMoneda([doc(null, 10), doc('USD', 1), doc(null, 20)])
    expect(r[r.length - 1]).toMatchObject({ moneda: null, total: 30, documentos: 2 })
  })

  it('cuenta el documento aunque su total sea nulo, sin sumar nada', () => {
    const r = totalesPorMoneda([doc('USD', null), doc('USD', 40)])
    expect(r).toEqual([{ moneda: 'USD', documentos: 2, total: 40 }])
  })

  it('ordena por cantidad de documentos y desempata por código', () => {
    const r = totalesPorMoneda([doc('EUR', 1), doc('USD', 1), doc('USD', 1), doc('ARS', 1)])
    expect(r.map((t) => t.moneda)).toEqual(['USD', 'ARS', 'EUR'])
  })

  it('sin documentos no devuelve nada', () => {
    expect(totalesPorMoneda([])).toEqual([])
  })

  it('las tres monedas del histórico conviven sin mezclarse', () => {
    const r = totalesPorMoneda([
      doc('ARS', 132_925_694.71),
      doc('USD', 2_055_384.7),
      doc('EUR', 6711.81),
      doc(null, 13_165_570.54),
    ])
    expect(r).toHaveLength(4)
    // Con un documento cada una, el orden lo pone el código; «sin moneda» va
    // último siempre.
    expect(r.map((t) => t.moneda)).toEqual(['ARS', 'EUR', 'USD', null])
    expect(r.map((t) => t.total)).toEqual([
      132_925_694.71,
      6711.81,
      2_055_384.7,
      13_165_570.54,
    ])
  })
})
