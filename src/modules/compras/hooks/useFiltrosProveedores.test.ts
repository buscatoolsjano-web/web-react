import { describe, expect, it } from 'vitest'
import { escribirFiltros, leerFiltros } from './useFiltrosProveedores'
import { FILTROS_INICIALES } from '../types'

const leer = (qs: string) => leerFiltros(new URLSearchParams(qs))
const escribir = (f: Parameters<typeof escribirFiltros>[0]) => escribirFiltros(f).toString()

describe('leerFiltros', () => {
  it('una URL vacía da los filtros iniciales', () => {
    expect(leer('')).toEqual(FILTROS_INICIALES)
  })

  it('lee lo que hay', () => {
    const f = leer('q=rex&estado=inactive&revision=1&bajas=1&page=3&per=50&orden=pais&dir=desc')
    expect(f).toEqual({
      q: 'rex',
      estado: 'inactive',
      soloRevision: true,
      incluirBajas: true,
      pagina: 3,
      porPagina: 50,
      orden: 'pais',
      direccion: 'desc',
    })
  })

  it('un estado inventado se ignora en vez de romper la consulta', () => {
    expect(leer('estado=lo-que-sea').estado).toBe('')
  })

  it('un orden inventado cae al inicial', () => {
    expect(leer('orden=cuit').orden).toBe('nombre')
  })

  it('un tamaño de página que no está en la lista cae al inicial', () => {
    expect(leer('per=999').porPagina).toBe(25)
    expect(leer('per=50').porPagina).toBe(50)
  })

  it('una página que no es un entero positivo cae a la 1', () => {
    expect(leer('page=0').pagina).toBe(1)
    expect(leer('page=-3').pagina).toBe(1)
    expect(leer('page=hola').pagina).toBe(1)
  })
})

describe('escribirFiltros', () => {
  it('los valores por defecto no ensucian la URL', () => {
    expect(escribir(FILTROS_INICIALES)).toBe('')
  })

  it('escribe sólo lo que difiere', () => {
    expect(escribir({ ...FILTROS_INICIALES, q: '  rex  ' })).toBe('q=rex')
    expect(escribir({ ...FILTROS_INICIALES, estado: 'active' })).toBe('estado=active')
    expect(escribir({ ...FILTROS_INICIALES, pagina: 2 })).toBe('page=2')
  })

  it('ida y vuelta: lo que se escribe se vuelve a leer igual', () => {
    const original = {
      q: 'wilkox',
      estado: 'inactive',
      soloRevision: true,
      incluirBajas: true,
      pagina: 4,
      porPagina: 100,
      orden: 'formaPago' as const,
      direccion: 'desc' as const,
    }
    expect(leerFiltros(escribirFiltros(original))).toEqual(original)
  })
})
