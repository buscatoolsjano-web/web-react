import { describe, expect, it } from 'vitest'
import { esIdDeYoutube, tituloDeVideo } from './logica'

describe('tituloDeVideo', () => {
  it('orden, equipo con serie, cliente y fecha', () => {
    expect(
      tituloDeVideo({ referencia: 'OS00012', modelo: 'FEIN ASM18-8-PC', serie: '000460', cliente: 'Whirlpool Argentina S.A.', fecha: '2026-11-20' }),
    ).toBe('OS00012 · FEIN ASM18-8-PC serie 000460 · Whirlpool Argentina S.A. · 20/11/2026')
  })

  it('sin modelo ni cliente no deja separadores sueltos', () => {
    expect(tituloDeVideo({ referencia: 'ACT00186', modelo: null, serie: null, cliente: null, fecha: '2026-01-05' })).toBe(
      'ACT00186 · 05/01/2026',
    )
  })

  it('saca < y > (YouTube los rechaza) y no pasa de 100 caracteres', () => {
    const t = tituloDeVideo({ referencia: 'OS1', modelo: '<X>', serie: null, cliente: 'C'.repeat(200), fecha: '2026-11-20' })
    expect(t).not.toMatch(/[<>]/)
    expect(t.length).toBeLessThanOrEqual(100)
    expect(t.startsWith('OS1 · X')).toBe(true)
  })
})

it('esIdDeYoutube', () => {
  expect(esIdDeYoutube('dQw4w9WgXcQ')).toBe(true)
  expect(esIdDeYoutube('corto')).toBe(false)
  expect(esIdDeYoutube('dQw4w9WgXcQ"><script')).toBe(false)
})
