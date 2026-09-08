import { describe, expect, it } from 'vitest'
import { escribirFiltros, leerFiltros } from './useFiltrosCatalogo'
import { FILTROS_INICIALES, type FiltrosCatalogo } from '../types'

function f(over: Partial<FiltrosCatalogo> = {}): FiltrosCatalogo {
  return { ...FILTROS_INICIALES, ...over }
}

describe('filtros del catálogo en la URL', () => {
  it('U5 · ida y vuelta sin pérdida', () => {
    const original = f({
      q: 'punta torx',
      marca: 'm-1',
      categoria: 'c-1',
      serie: 'S9',
      atributos: { encastre: '1/2' },
      pagina: 3,
      porPagina: 25,
      orden: 'sku',
    })
    expect(leerFiltros(escribirFiltros(original))).toEqual(original)
  })

  it('U5 · omite los valores por defecto para no ensuciar la URL', () => {
    expect(escribirFiltros(f()).toString()).toBe('')
  })

  it('interpreta como atributo cualquier clave que no sea reservada', () => {
    const r = leerFiltros(new URLSearchParams('cat=c1&encastre=1%2F2&largo=50&page=2'))
    expect(r.categoria).toBe('c1')
    expect(r.atributos).toEqual({ encastre: '1/2', largo: '50' })
    expect(r.pagina).toBe(2)
  })

  it('descarta valores inválidos en vez de romper', () => {
    const r = leerFiltros(new URLSearchParams('page=abc&per=-5&orden=loquesea'))
    expect(r.pagina).toBe(1)
    expect(r.porPagina).toBe(FILTROS_INICIALES.porPagina)
    expect(r.orden).toBe(FILTROS_INICIALES.orden)
  })

  it('recorta el texto de búsqueda', () => {
    expect(leerFiltros(escribirFiltros(f({ q: '  punta  ' }))).q).toBe('punta')
  })
})
