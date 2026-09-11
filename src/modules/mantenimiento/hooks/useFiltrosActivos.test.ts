import { describe, expect, it } from 'vitest'
import { escribirFiltros, leerFiltros } from './useFiltrosActivos'
import { FILTROS_ACTIVOS_INICIALES } from '../types'

const leer = (qs: string) => leerFiltros(new URLSearchParams(qs))
const escribir = (f: Parameters<typeof escribirFiltros>[0]) => escribirFiltros(f).toString()

describe('leerFiltros', () => {
  it('una URL vacía da los filtros iniciales', () => {
    expect(leer('')).toEqual(FILTROS_ACTIVOS_INICIALES)
  })

  it('lee los cinco filtros', () => {
    const f = leer('q=EQ00001&cli=abc&prod=def&tipo=Atornillador&estado=baja')
    expect(f.q).toBe('EQ00001')
    expect(f.clienteId).toBe('abc')
    expect(f.productoId).toBe('def')
    expect(f.tipo).toBe('Atornillador')
    expect(f.estado).toBe('baja')
  })

  it('un estado inventado se ignora en vez de romper la consulta', () => {
    expect(leer('estado=lo-que-sea').estado).toBe('')
  })

  it('un tamaño de página que no está en la lista vuelve al de por defecto', () => {
    expect(leer('per=7').porPagina).toBe(FILTROS_ACTIVOS_INICIALES.porPagina)
    expect(leer('per=50').porPagina).toBe(50)
  })

  it('una página que no es un entero positivo vuelve a la primera', () => {
    expect(leer('page=0').pagina).toBe(1)
    expect(leer('page=-3').pagina).toBe(1)
    expect(leer('page=hola').pagina).toBe(1)
    expect(leer('page=4').pagina).toBe(4)
  })

  it('un orden inventado vuelve al de por defecto', () => {
    expect(leer('orden=lo-que-sea').orden).toBe(FILTROS_ACTIVOS_INICIALES.orden)
    expect(leer('orden=serie').orden).toBe('serie')
  })
})

describe('escribirFiltros', () => {
  it('los valores por defecto no van a la URL', () => {
    expect(escribir(FILTROS_ACTIVOS_INICIALES)).toBe('')
  })

  it('sólo escribe lo que difiere', () => {
    expect(escribir({ ...FILTROS_ACTIVOS_INICIALES, estado: 'activo' })).toBe('estado=activo')
  })

  it('el buscador se escribe sin espacios de más', () => {
    expect(escribir({ ...FILTROS_ACTIVOS_INICIALES, q: '  EQ1  ' })).toBe('q=EQ1')
    expect(escribir({ ...FILTROS_ACTIVOS_INICIALES, q: '   ' })).toBe('')
  })

  it('ida y vuelta: lo que se escribe se vuelve a leer igual', () => {
    const original = {
      ...FILTROS_ACTIVOS_INICIALES,
      q: 'FEIN',
      clienteId: 'c-1',
      productoId: 'p-1',
      tipo: 'Llave de impacto',
      estado: 'activo',
      pagina: 3,
      porPagina: 50,
      orden: 'serie' as const,
      direccion: 'asc' as const,
    }
    expect(leer(escribir(original))).toEqual(original)
  })
})
