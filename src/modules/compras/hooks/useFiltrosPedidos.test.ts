import { describe, expect, it } from 'vitest'
import { escribirFiltros, leerFiltros } from './useFiltrosPedidos'
import { FILTROS_PEDIDOS_INICIALES } from '../types'

const leer = (qs: string) => leerFiltros(new URLSearchParams(qs))
const escribir = (f: Parameters<typeof escribirFiltros>[0]) => escribirFiltros(f).toString()

describe('leerFiltros', () => {
  it('una URL vacía da los filtros iniciales', () => {
    expect(leer('')).toEqual(FILTROS_PEDIDOS_INICIALES)
  })

  it('lee los siete filtros', () => {
    const f = leer(
      'q=PC000&prov=abc&estado=confirmed&recepcion=partially_received&moneda=usd' +
        '&desde=2026-01-01&hasta=2026-12-31&eta_desde=2026-02-01&eta_hasta=2026-03-01',
    )
    expect(f.q).toBe('PC000')
    expect(f.proveedorId).toBe('abc')
    expect(f.estado).toBe('confirmed')
    expect(f.estadoRecepcion).toBe('partially_received')
    expect(f.moneda).toBe('USD')
    expect(f.desde).toBe('2026-01-01')
    expect(f.hasta).toBe('2026-12-31')
    expect(f.etaDesde).toBe('2026-02-01')
    expect(f.etaHasta).toBe('2026-03-01')
  })

  it('un estado inventado se ignora en vez de romper la consulta', () => {
    expect(leer('estado=lo-que-sea').estado).toBe('')
    expect(leer('recepcion=lo-que-sea').estadoRecepcion).toBe('')
  })

  it('una fecha que no es una fecha se ignora', () => {
    expect(leer('desde=ayer').desde).toBe('')
    expect(leer('hasta=2026-13-99').hasta).toBe('2026-13-99')
    expect(leer('eta_desde=01/02/2026').etaDesde).toBe('')
  })

  it('una moneda que no tiene tres letras se ignora', () => {
    expect(leer('moneda=dolares').moneda).toBe('')
    expect(leer('moneda=ars').moneda).toBe('ARS')
  })

  it('«sin ETA» es un filtro aparte', () => {
    expect(leer('sin_eta=1').sinEta).toBe(true)
    expect(leer('').sinEta).toBe(false)
  })

  it('el orden por defecto es por fecha descendente', () => {
    expect(leer('').orden).toBe('fecha')
    expect(leer('').direccion).toBe('desc')
    expect(leer('dir=asc').direccion).toBe('asc')
  })

  it('un orden inventado cae al inicial', () => {
    expect(leer('orden=proveedorcito').orden).toBe('fecha')
  })
})

describe('escribirFiltros', () => {
  it('los valores por defecto no ensucian la URL', () => {
    expect(escribir(FILTROS_PEDIDOS_INICIALES)).toBe('')
  })

  it('escribe sólo lo que difiere', () => {
    expect(escribir({ ...FILTROS_PEDIDOS_INICIALES, estado: 'draft' })).toBe('estado=draft')
    expect(escribir({ ...FILTROS_PEDIDOS_INICIALES, sinEta: true })).toBe('sin_eta=1')
  })

  it('ida y vuelta: lo que se escribe se vuelve a leer igual', () => {
    const original = {
      q: 'PC00007',
      proveedorId: 'abc-def',
      estado: 'cancelled',
      estadoRecepcion: 'received',
      moneda: 'EUR',
      desde: '2026-01-01',
      hasta: '2026-06-30',
      etaDesde: '2026-02-01',
      etaHasta: '2026-04-30',
      sinEta: true,
      pagina: 3,
      porPagina: 50,
      orden: 'total' as const,
      direccion: 'asc' as const,
    }
    expect(leerFiltros(escribirFiltros(original))).toEqual(original)
  })
})
