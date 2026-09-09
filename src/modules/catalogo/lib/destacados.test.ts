import { describe, expect, it } from 'vitest'
import { atributosDestacados } from './destacados'

describe('atributosDestacados', () => {
  it('devuelve como mucho los que se le piden', () => {
    const r = atributosDestacados({ encastre: '1/4 HEX', largo: '25', medida: '10' }, 2)
    expect(r).toHaveLength(2)
    expect(r[0]).toEqual({ key: 'encastre', valor: '1/4 HEX', texto: '1/4 HEX' })
  })

  it('agrega la unidad, porque un "1" suelto no dice nada', () => {
    const r = atributosDestacados({ max_kg: 1, carcasa: 'ALUMINIO' }, 2,
      new Map([['max_kg', 'kg'], ['carcasa', null]]))
    expect(r.map((d) => d.texto)).toEqual(['1 kg', 'ALUMINIO'])
  })

  it('salta las claves que no aportan en una card', () => {
    // `modelo` tiene 512 valores distintos sobre 513 productos: es
    // prácticamente un identificador.
    const r = atributosDestacados({ modelo: 'X-1', sufijos: 'AB', carcasa: 'ALUMINIO' }, 2)
    expect(r).toEqual([{ key: 'carcasa', valor: 'ALUMINIO', texto: 'ALUMINIO' }])
  })

  it("salta el marcador de ausencia '-'", () => {
    expect(atributosDestacados({ encastre: '-', largo: '25' }, 2))
      .toEqual([{ key: 'largo', valor: '25', texto: '25' }])
  })

  it('salta vacíos y nulos sin romper', () => {
    expect(atributosDestacados({ a: '', b: null, c: undefined, d: '  ', e: 'ok' }, 2))
      .toEqual([{ key: 'e', valor: 'ok', texto: 'ok' }])
  })

  it('acepta números y booleanos', () => {
    expect(atributosDestacados({ max_kg: 12.5, kit: true }, 2))
      .toEqual([
        { key: 'max_kg', valor: '12.5', texto: '12.5' },
        { key: 'kit', valor: 'true', texto: 'true' },
      ])
  })

  it('junta los arrays en un solo texto', () => {
    expect(atributosDestacados({ sufijo: ['A', 'B'] }, 1))
      .toEqual([{ key: 'sufijo', valor: 'A · B', texto: 'A · B' }])
  })

  it('sin atributos devuelve lista vacía', () => {
    expect(atributosDestacados({}, 2)).toEqual([])
  })
})
