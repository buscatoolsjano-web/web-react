import { describe, expect, it } from 'vitest'
import { fueraDeRango, limitesPorPrecision, normalizarModelo } from './modelos'

describe('normalizarModelo', () => {
  it('cruza las formas en que está escrito el modelo en la base', () => {
    for (const t of ['ASM18-12- PC', 'ASM 18-12-PC', 'ASM18-12-PC', 'FEIN ASM18-12-PC', 'asm18-12']) {
      expect(normalizarModelo(t), t).toBe('ASM18-12')
    }
    expect(normalizarModelo('ASW18-45 - PC')).toBe('ASW18-45')
    expect(normalizarModelo('FEIN ASM18-8-PC')).toBe('ASM18-8')
  })
  it('lo que no es un modelo conocido queda igual de distinto', () => {
    expect(normalizarModelo('ASW 10-6-2ST')).toBe('ASW10-6-2ST')
    expect(normalizarModelo(null)).toBe('')
  })
})

describe('limitesPorPrecision', () => {
  it('±10 % del nominal, a dos decimales', () => {
    expect(limitesPorPrecision(5, 10)).toEqual({ lsl: 4.5, usl: 5.5 })
    expect(limitesPorPrecision(2.35, 10)).toEqual({ lsl: 2.12, usl: 2.59 })
  })
})

describe('fueraDeRango', () => {
  const rango = { min: 1, max: 8 }
  it('avisa sólo si el nominal está afuera', () => {
    expect(fueraDeRango(9, rango)).toBe(true)
    expect(fueraDeRango(0.5, rango)).toBe(true)
    expect(fueraDeRango(8, rango)).toBe(false)
    expect(fueraDeRango(null, rango)).toBe(false)
  })
})
