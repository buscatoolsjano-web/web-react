import { describe, expect, it } from 'vitest'
import { deserializar, serializar } from './persistCache'

/**
 * La caché persistida y los `Map` (Fase 234): con `JSON.stringify` pelado un
 * `Map` volvía como `{}` al recargar, y la cotización se caía con
 * «n?.get is not a function».
 */
describe('serializar / deserializar de la caché persistida', () => {
  it('un Map vuelve como Map, con sus entradas', () => {
    const historicos = new Map([['p1', { precio: 2347, moneda: 'USD' }]])
    const vuelta = deserializar<{ data: Map<string, { precio: number }> }>(serializar({ data: historicos }))
    expect(vuelta.data).toBeInstanceOf(Map)
    expect(vuelta.data.get('p1')).toEqual({ precio: 2347, moneda: 'USD' })
  })

  it('un Map de Sets anidado (atributos por categoría) también', () => {
    const porCategoria = new Map([['cat', new Set(['min_kg', 'max_kg'])]])
    const vuelta = deserializar<Map<string, Set<string>>>(serializar(porCategoria))
    expect(vuelta.get('cat')).toBeInstanceOf(Set)
    expect(vuelta.get('cat')?.has('max_kg')).toBe(true)
  })

  it('lo demás queda igual que con JSON común', () => {
    const datos = { a: 1, b: [1, 2], c: null, d: 'texto' }
    expect(deserializar(serializar(datos))).toEqual(datos)
  })
})
