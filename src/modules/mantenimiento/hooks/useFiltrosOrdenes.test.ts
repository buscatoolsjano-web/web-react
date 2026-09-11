import { describe, expect, it } from 'vitest'
import { escribirFiltros, leerFiltros } from './useFiltrosOrdenes'
import { FILTROS_ORDENES_INICIALES } from '../types'

const leer = (qs: string) => leerFiltros(new URLSearchParams(qs))
const escribir = (f: Parameters<typeof escribirFiltros>[0]) => escribirFiltros(f).toString()

describe('leerFiltros', () => {
  it('una URL vacía da los filtros iniciales', () => {
    expect(leer('')).toEqual(FILTROS_ORDENES_INICIALES)
  })

  it('lee los nueve filtros', () => {
    const f = leer(
      'q=OS000&cli=abc&eq=def&estado=open&etapa=repair&tec=ghi&espera=si' +
        '&desde=2026-01-01&hasta=2026-12-31',
    )
    expect(f.q).toBe('OS000')
    expect(f.clienteId).toBe('abc')
    expect(f.activoId).toBe('def')
    expect(f.estado).toBe('open')
    expect(f.etapa).toBe('repair')
    expect(f.tecnicoId).toBe('ghi')
    expect(f.enEspera).toBe('si')
    expect(f.desde).toBe('2026-01-01')
    expect(f.hasta).toBe('2026-12-31')
  })

  it('los tres ejes de estado se leen por separado', () => {
    // Son tres cosas distintas: el ciclo de vida del documento, dónde está el
    // trabajo y si está pausado. Un solo desplegable combinado no podría
    // distinguir «abierta y en espera» de «abierta y avanzando».
    const f = leer('estado=open&etapa=torque&espera=no')
    expect([f.estado, f.etapa, f.enEspera]).toEqual(['open', 'torque', 'no'])
  })

  it('un valor inventado en cualquiera de los tres se ignora', () => {
    expect(leer('estado=lo-que-sea').estado).toBe('')
    expect(leer('etapa=lo-que-sea').etapa).toBe('')
    expect(leer('espera=quizas').enEspera).toBe('')
  })

  it('una fecha que no es una fecha se ignora', () => {
    expect(leer('desde=ayer').desde).toBe('')
    expect(leer('hasta=01/02/2026').hasta).toBe('')
  })

  it('un tamaño de página fuera de la lista vuelve al de por defecto', () => {
    expect(leer('per=7').porPagina).toBe(FILTROS_ORDENES_INICIALES.porPagina)
    expect(leer('per=100').porPagina).toBe(100)
  })
})

describe('escribirFiltros', () => {
  it('los valores por defecto no van a la URL', () => {
    expect(escribir(FILTROS_ORDENES_INICIALES)).toBe('')
  })

  it('ida y vuelta: lo que se escribe se vuelve a leer igual', () => {
    const original = {
      ...FILTROS_ORDENES_INICIALES,
      q: 'OS00007',
      clienteId: 'c-1',
      activoId: 'a-1',
      estado: 'closed',
      etapa: 'closing',
      tecnicoId: 't-1',
      enEspera: 'no',
      desde: '2026-01-01',
      hasta: '2026-12-31',
      pagina: 2,
      porPagina: 10,
      orden: 'numero' as const,
      direccion: 'asc' as const,
    }
    expect(leer(escribir(original))).toEqual(original)
  })
})
