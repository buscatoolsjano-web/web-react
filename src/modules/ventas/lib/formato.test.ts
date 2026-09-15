import { describe, expect, it } from 'vitest'
import {
  formatearCantidad,
  formatearFecha,
  formatearImporte,
} from './formato'

describe('formatearImporte', () => {
  it('muestra el importe con su moneda', () => {
    expect(formatearImporte(1234.5, 'USD')).toBe('USD 1.234,50')
  })

  it('un total nulo es una raya, nunca un cero', () => {
    expect(formatearImporte(null, 'USD')).toBe('—')
  })

  it('sin moneda muestra el número solo — no supone ARS', () => {
    // 32 documentos históricos no tienen moneda y ninguno dice cuál es.
    expect(formatearImporte(1000, null)).toBe('1.000,00')
  })

  it('el cero es un importe real y se muestra', () => {
    expect(formatearImporte(0, 'ARS')).toBe('ARS 0,00')
  })
})

describe('formatearFecha', () => {
  it('convierte ISO a formato local sin correrse un día', () => {
    // Con `new Date('2026-01-06')` en UTC−3 esto daría 05/01/2026.
    expect(formatearFecha('2026-01-06')).toBe('06/01/2026')
  })

  it('acepta un timestamp completo', () => {
    expect(formatearFecha('2026-09-08T14:02:00Z')).toBe('08/09/2026')
  })

  it('null y basura no rompen', () => {
    expect(formatearFecha(null)).toBe('—')
    expect(formatearFecha('cualquier cosa')).toBe('cualquier cosa')
  })
})

describe('formatearCantidad', () => {
  it('muestra el cero', () => {
    expect(formatearCantidad(0)).toBe('0')
  })

  it('null es raya', () => {
    expect(formatearCantidad(null)).toBe('—')
  })
})
