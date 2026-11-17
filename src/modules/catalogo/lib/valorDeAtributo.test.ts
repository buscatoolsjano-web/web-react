import { describe, expect, it } from 'vitest'
import { claveDeComparacion, limpiarValor, resolverValor, sonTodosNumeros } from './valorDeAtributo'

describe('resolverValor', () => {
  const existentes = ['1/4 HEX', '1/2 SQ', 'Acero inoxidable', '1/4"']

  it('usa el que ya existe si es el mismo escrito distinto', () => {
    expect(resolverValor('1/4 Hex', existentes)).toEqual({ valor: '1/4 HEX', existente: true, corregido: true })
    expect(resolverValor('  1/4hex ', existentes).valor).toBe('1/4 HEX')
    expect(resolverValor('acero inoxidáble', existentes).valor).toBe('Acero inoxidable')
    expect(resolverValor('1/4″', existentes).valor).toBe('1/4"')
    expect(resolverValor("1/4''", existentes).valor).toBe('1/4"')
  })

  it('el mismo valor exacto no se marca como corregido', () => {
    expect(resolverValor('1/2 SQ', existentes)).toEqual({ valor: '1/2 SQ', existente: true, corregido: false })
  })

  it('un valor nuevo se guarda limpio', () => {
    expect(resolverValor('  3/8   HEX ', existentes)).toEqual({ valor: '3/8 HEX', existente: false, corregido: false })
  })
})

describe('auxiliares', () => {
  it('compara sin mayúsculas, espacios ni acentos', () => {
    expect(claveDeComparacion('Plástico')).toBe(claveDeComparacion('PLASTICO'))
    expect(claveDeComparacion('2,5')).toBe(claveDeComparacion('2.5'))
  })

  it('limpia espacios', () => {
    expect(limpiarValor('  a   b ')).toBe('a b')
  })

  it('reconoce una lista de números', () => {
    expect(sonTodosNumeros(['25', '50', '1,5'])).toBe(true)
    expect(sonTodosNumeros(['T25', '50'])).toBe(false)
    expect(sonTodosNumeros([])).toBe(false)
  })
})
