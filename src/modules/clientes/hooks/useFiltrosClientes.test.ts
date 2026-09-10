import { describe, expect, it } from 'vitest'
import { escribirFiltros, leerFiltros } from './useFiltrosClientes'
import { FILTROS_INICIALES, type FiltrosClientes } from '../types'

describe('filtros de clientes ↔ URL', () => {
  it('una URL vacía da los filtros por defecto', () => {
    expect(leerFiltros(new URLSearchParams())).toEqual(FILTROS_INICIALES)
  })

  it('los valores por defecto NO se escriben en la URL', () => {
    expect(escribirFiltros(FILTROS_INICIALES).toString()).toBe('')
  })

  it('ida y vuelta: lo que se escribe se vuelve a leer igual', () => {
    const filtros: FiltrosClientes = {
      q: 'mirgor',
      rubro: 'Gomería / Neumáticos',
      soloRevision: true,
      incluirBajas: true,
      pagina: 3,
      porPagina: 50,
      orden: 'cuit',
      direccion: 'desc',
    }
    expect(leerFiltros(escribirFiltros(filtros))).toEqual(filtros)
  })

  it('un tamaño de página inventado cae al valor por defecto', () => {
    const p = new URLSearchParams({ per: '7' })
    expect(leerFiltros(p).porPagina).toBe(FILTROS_INICIALES.porPagina)
  })

  it('una columna de orden inventada cae al valor por defecto', () => {
    const p = new URLSearchParams({ orden: 'lo-que-sea' })
    expect(leerFiltros(p).orden).toBe(FILTROS_INICIALES.orden)
  })

  it('una página negativa o cero cae en la primera', () => {
    expect(leerFiltros(new URLSearchParams({ page: '-2' })).pagina).toBe(1)
    expect(leerFiltros(new URLSearchParams({ page: '0' })).pagina).toBe(1)
  })

  it('el texto se guarda sin espacios de sobra', () => {
    expect(escribirFiltros({ ...FILTROS_INICIALES, q: '  acme  ' }).get('q')).toBe('acme')
  })

  it('un texto en blanco no ensucia la URL', () => {
    expect(escribirFiltros({ ...FILTROS_INICIALES, q: '   ' }).toString()).toBe('')
  })
})
