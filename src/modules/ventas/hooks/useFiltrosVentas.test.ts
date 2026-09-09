import { describe, expect, it } from 'vitest'
import { escribirFiltros, leerFiltros } from './useFiltrosVentas'
import { FILTROS_INICIALES, type FiltrosVentas } from '../types'

const url = (qs: string) => new URLSearchParams(qs)

describe('leerFiltros', () => {
  it('sin parámetros devuelve los valores iniciales', () => {
    expect(leerFiltros(url(''))).toEqual(FILTROS_INICIALES)
  })

  it('lee todos los filtros', () => {
    const f = leerFiltros(
      url('q=COTI02251&cliente=abc&estado=sent&moneda=USD&desde=2026-01-01&hasta=2026-06-30&revision=1&page=3&per=50&orden=total&dir=asc'),
    )
    expect(f).toEqual({
      q: 'COTI02251',
      clienteId: 'abc',
      estado: 'sent',
      moneda: 'USD',
      desde: '2026-01-01',
      hasta: '2026-06-30',
      soloRevision: true,
      pagina: 3,
      porPagina: 50,
      orden: 'total',
      direccion: 'asc',
    })
  })

  it('descarta valores inválidos en vez de romper', () => {
    const f = leerFiltros(url('page=-2&per=999&orden=inventado&dir=zzz'))
    expect(f.pagina).toBe(1)
    expect(f.porPagina).toBe(FILTROS_INICIALES.porPagina)
    expect(f.orden).toBe(FILTROS_INICIALES.orden)
    expect(f.direccion).toBe(FILTROS_INICIALES.direccion)
  })
})

describe('escribirFiltros', () => {
  it('no escribe lo que ya es el valor por defecto', () => {
    expect(escribirFiltros(FILTROS_INICIALES).toString()).toBe('')
  })

  it('ida y vuelta', () => {
    const original: FiltrosVentas = {
      q: 'PDV01295',
      clienteId: 'cli-1',
      estado: 'confirmed',
      moneda: 'ARS',
      desde: '2026-02-01',
      hasta: null,
      soloRevision: true,
      pagina: 4,
      porPagina: 100,
      orden: 'cliente',
      direccion: 'asc',
    }
    expect(leerFiltros(escribirFiltros(original))).toEqual(original)
  })

  it('recorta los espacios de la búsqueda', () => {
    const p = escribirFiltros({ ...FILTROS_INICIALES, q: '  RT0000001406  ' })
    expect(p.get('q')).toBe('RT0000001406')
  })

  it('una búsqueda en blanco no ensucia la URL', () => {
    expect(escribirFiltros({ ...FILTROS_INICIALES, q: '   ' }).toString()).toBe('')
  })
})
