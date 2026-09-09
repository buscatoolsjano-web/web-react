import { describe, expect, it } from 'vitest'
import { atributosDestacados } from './destacados'

describe('atributosDestacados', () => {
  it('devuelve como mucho los que se le piden', () => {
    const r = atributosDestacados({ encastre: '1/4 HEX', largo: '25', medida: '10' }, 2)
    expect(r).toHaveLength(2)
    expect(r[0]).toEqual({ key: 'encastre', valor: '1/4 HEX' })
  })

  it('salta las claves que no aportan en una card', () => {
    // `modelo` tiene 512 valores distintos sobre 513 productos: es
    // prácticamente un identificador.
    const r = atributosDestacados({ modelo: 'X-1', sufijos: 'AB', carcasa: 'ALUMINIO' }, 2)
    expect(r).toEqual([{ key: 'carcasa', valor: 'ALUMINIO' }])
  })

  it("salta el marcador de ausencia '-'", () => {
    expect(atributosDestacados({ encastre: '-', largo: '25' }, 2))
      .toEqual([{ key: 'largo', valor: '25' }])
  })

  it('salta vacíos y nulos sin romper', () => {
    expect(atributosDestacados({ a: '', b: null, c: undefined, d: '  ', e: 'ok' }, 2))
      .toEqual([{ key: 'e', valor: 'ok' }])
  })

  it('acepta números y booleanos', () => {
    expect(atributosDestacados({ max_kg: 12.5, kit: true }, 2))
      .toEqual([{ key: 'max_kg', valor: '12.5' }, { key: 'kit', valor: 'true' }])
  })

  it('junta los arrays en un solo texto', () => {
    expect(atributosDestacados({ sufijo: ['A', 'B'] }, 1))
      .toEqual([{ key: 'sufijo', valor: 'A · B' }])
  })

  it('sin atributos devuelve lista vacía', () => {
    expect(atributosDestacados({}, 2)).toEqual([])
  })
})
