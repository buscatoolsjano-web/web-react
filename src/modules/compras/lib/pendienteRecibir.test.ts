import { describe, expect, it } from 'vitest'
import { estadoDeRecepcion, pasaFiltro } from './pendienteRecibir'

const HOY = '2026-11-11'
const p = (over: Partial<Parameters<typeof pasaFiltro>[0]> = {}) => ({
  productoId: 'p', sku: 'X', nombre: 'X', pedido: 10, recibido: 0, pendiente: 10,
  paraVentas: 0, paraStock: 10, proximaLlegada: '2026-12-01', atrasado: false, documentos: [], ...over,
})

describe('pendiente de recibir (Fase 238)', () => {
  it('atrasado si la llegada estimada ya pasó; si no, en camino o sin fecha', () => {
    expect(estadoDeRecepcion(p({ proximaLlegada: '2026-11-01' }), HOY).tono).toBe('tAtrasado')
    expect(estadoDeRecepcion(p(), HOY).texto).toBe('En camino')
    expect(estadoDeRecepcion(p({ proximaLlegada: null }), HOY).texto).toBe('Sin fecha')
  })

  it('dice «Parcial» cuando ya llegó una parte', () => {
    expect(estadoDeRecepcion(p({ recibido: 4 }), HOY).texto).toBe('Parcial · En camino')
  })

  it('los filtros: atrasados, para ventas, sin fecha', () => {
    expect(pasaFiltro(p({ atrasado: true }), 'atrasado', HOY)).toBe(true)
    expect(pasaFiltro(p({ paraVentas: 3 }), 'ventas', HOY)).toBe(true)
    expect(pasaFiltro(p(), 'ventas', HOY)).toBe(false)
    expect(pasaFiltro(p({ proximaLlegada: null }), 'sinFecha', HOY)).toBe(true)
  })
})
