import { describe, expect, it } from 'vitest'
import { escribirFiltros, leerFiltros } from './useFiltrosCatalogo'
import { FILTROS_INICIALES, type FiltrosCatalogo } from '../types'

function f(over: Partial<FiltrosCatalogo> = {}): FiltrosCatalogo {
  return { ...FILTROS_INICIALES, ...over }
}

describe('filtros del catálogo en la URL', () => {
  it('U1/U2 · ida y vuelta sin pérdida, con multiselección y rangos', () => {
    const original = f({
      q: 'punta torx',
      marca: 'm-1',
      categoria: 'c-1',
      subtipos: ['Torx', 'Allen'],
      serie: 'S9',
      atributos: { encastre: ['1/4 HEX', '3/8 SQ'], medida: ['10'] },
      rangos: { largo: { min: 25, max: 50 }, max_kg: { min: 10, max: null } },
      pagina: 3,
      porPagina: 25,
      orden: 'sku',
    })
    expect(leerFiltros(escribirFiltros(original))).toEqual(original)
  })

  it('omite los valores por defecto para no ensuciar la URL', () => {
    expect(escribirFiltros(f()).toString()).toBe('')
  })

  it('U1 · un link compartido con un solo valor sigue funcionando', () => {
    // Los links de antes de la multiselección traen `?encastre=1/2`. Se leen
    // como un array de uno, así que no se rompen.
    const r = leerFiltros(new URLSearchParams('cat=c1&encastre=1%2F2&largo=50&page=2'))
    expect(r.categoria).toBe('c1')
    expect(r.atributos).toEqual({ encastre: ['1/2'], largo: ['50'] })
    expect(r.pagina).toBe(2)
  })

  it('lee varios valores repetidos de la misma clave', () => {
    const r = leerFiltros(new URLSearchParams('encastre=1%2F4+HEX&encastre=3%2F8+SQ&tipo=Torx&tipo=Allen'))
    expect(r.atributos['encastre']).toEqual(['1/4 HEX', '3/8 SQ'])
    expect(r.subtipos).toEqual(['Torx', 'Allen'])
  })

  it('los rangos van en su propio espacio de nombres', () => {
    // Hace falta porque hay atributos llamados `min_kg` y `max_kg`: un
    // prefijo tipo `min_` chocaría contra ellos.
    const r = leerFiltros(new URLSearchParams('rango.largo.min=25&rango.largo.max=50&max_kg=180'))
    expect(r.rangos).toEqual({ largo: { min: 25, max: 50 } })
    expect(r.atributos['max_kg']).toEqual(['180'])
  })

  it('descarta valores inválidos en vez de romper', () => {
    const r = leerFiltros(
      new URLSearchParams('page=abc&per=-5&orden=loquesea&rango.largo.min=hola&rango.mal=3'),
    )
    expect(r.pagina).toBe(1)
    expect(r.porPagina).toBe(FILTROS_INICIALES.porPagina)
    expect(r.orden).toBe(FILTROS_INICIALES.orden)
    expect(r.rangos).toEqual({})
  })

  it('recorta el texto de búsqueda', () => {
    expect(leerFiltros(escribirFiltros(f({ q: '  punta  ' }))).q).toBe('punta')
  })

  it('U3/U4 · el mismo querystring produce siempre los mismos filtros', () => {
    // Atrás y adelante del navegador vuelven a montar el componente con una
    // URL anterior: leer tiene que ser determinista.
    const qs = 'cat=c1&tipo=Torx&encastre=1%2F4+HEX&rango.largo.min=25&page=2'
    expect(leerFiltros(new URLSearchParams(qs))).toEqual(leerFiltros(new URLSearchParams(qs)))
  })
})
