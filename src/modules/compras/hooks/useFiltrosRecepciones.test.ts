import { describe, expect, it } from 'vitest'
import { escribirFiltros, leerFiltros } from './useFiltrosRecepciones'
import { FILTROS_RECEPCIONES_INICIALES } from '../types'

const leer = (qs: string) => leerFiltros(new URLSearchParams(qs))

describe('leerFiltros de recepciones', () => {
  it('una URL vacía da los filtros iniciales', () => {
    expect(leer('')).toEqual(FILTROS_RECEPCIONES_INICIALES)
  })

  it('lee los seis filtros', () => {
    const f = leer('q=NEP000&prov=p1&pedido=pc1&estado=confirmed&dep=d1&desde=2026-01-01&hasta=2026-12-31')
    expect(f.q).toBe('NEP000')
    expect(f.proveedorId).toBe('p1')
    expect(f.pedidoId).toBe('pc1')
    expect(f.estado).toBe('confirmed')
    expect(f.depositoId).toBe('d1')
    expect(f.desde).toBe('2026-01-01')
    expect(f.hasta).toBe('2026-12-31')
  })

  it('un estado que no existe se ignora: los del CHECK son dos', () => {
    expect(leer('estado=cancelled').estado).toBe('')
    expect(leer('estado=draft').estado).toBe('draft')
    expect(leer('estado=confirmed').estado).toBe('confirmed')
  })

  it('una fecha que no es una fecha se ignora', () => {
    expect(leer('desde=hoy').desde).toBe('')
  })

  it('el orden por defecto es por fecha descendente', () => {
    expect(leer('').orden).toBe('fecha')
    expect(leer('').direccion).toBe('desc')
  })
})

describe('escribirFiltros de recepciones', () => {
  it('los valores por defecto no ensucian la URL', () => {
    expect(escribirFiltros(FILTROS_RECEPCIONES_INICIALES).toString()).toBe('')
  })

  it('ida y vuelta: lo que se escribe se vuelve a leer igual', () => {
    const original = {
      q: 'NEP00003',
      proveedorId: 'abc',
      pedidoId: 'def',
      estado: 'draft',
      depositoId: 'ghi',
      desde: '2026-02-01',
      hasta: '2026-03-01',
      pagina: 2,
      porPagina: 50,
      orden: 'proveedor' as const,
      direccion: 'asc' as const,
    }
    expect(leerFiltros(escribirFiltros(original))).toEqual(original)
  })
})
