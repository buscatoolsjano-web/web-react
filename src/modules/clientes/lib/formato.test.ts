import { describe, expect, it } from 'vitest'
import { formatearCuit, formatearFecha, formatearImporte, nombreVisible } from './formato'

describe('formatearImporte', () => {
  it('un total nulo es una raya, nunca un cero', () => {
    expect(formatearImporte(null, 'USD')).toBe('—')
  })

  it('sin moneda muestra el número solo, sin suponer ARS', () => {
    expect(formatearImporte(1234.5, null)).not.toContain('ARS')
    expect(formatearImporte(1234.5, null)).toContain('1.234,50')
  })

  it('con moneda la antepone', () => {
    expect(formatearImporte(1234.5, 'USD')).toBe('USD 1.234,50')
  })
})

describe('formatearFecha', () => {
  it('no se corre un día por la zona horaria', () => {
    expect(formatearFecha('2026-01-01')).toBe('01/01/2026')
  })

  it('acepta un timestamp completo', () => {
    expect(formatearFecha('2026-09-10T00:53:53.270Z')).toBe('10/09/2026')
  })

  it('sin fecha, raya', () => {
    expect(formatearFecha(null)).toBe('—')
  })
})

describe('formatearCuit', () => {
  it('agrupa los once dígitos', () => {
    expect(formatearCuit('30503284410')).toBe('30-50328441-0')
  })

  it('acepta el que ya viene con guiones', () => {
    expect(formatearCuit('30-50287435-3')).toBe('30-50287435-3')
  })

  it('lo que no es un CUIT se muestra tal cual, sin corregirlo', () => {
    expect(formatearCuit('en trámite')).toBe('en trámite')
    expect(formatearCuit('123')).toBe('123')
  })

  it('sin CUIT, raya', () => {
    expect(formatearCuit(null)).toBe('—')
  })
})

describe('nombreVisible', () => {
  it('prefiere el nombre comercial', () => {
    expect(nombreVisible('Acme S.A.', 'Acme')).toBe('Acme')
  })

  it('sin nombre comercial usa la razón social', () => {
    expect(nombreVisible('Acme S.A.', null)).toBe('Acme S.A.')
    expect(nombreVisible('Acme S.A.', '   ')).toBe('Acme S.A.')
  })
})
