import { describe, expect, it, vi } from 'vitest'

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
const { cruzaDeLado, leerParametroCopia, rutaDeCopia, DESTINOS } = await import('./copiarDocumento')

const ID = '6f1c0d2e-7a51-4c3b-9b1e-2a6d1c9e8f70'

describe('«Duplicar como…» (Fase 233)', () => {
  it('ofrece los tres destinos: cotización, pedido de venta y pedido a proveedor', () => {
    expect(DESTINOS.map((d) => d.tipo)).toEqual(['cotizacion', 'pedido', 'pedido_compra'])
  })

  it('la ruta abre el ALTA del destino con el origen en la URL', () => {
    expect(rutaDeCopia('pedido_compra', 'cotizacion', ID)).toBe(`/compras/pedidos/nuevo?copiar=cotizacion:${ID}`)
    expect(rutaDeCopia('cotizacion', 'pedido_compra', ID)).toBe(`/ventas/cotizaciones/nueva?copiar=pedido_compra:${ID}`)
  })

  it('lee el parámetro de vuelta, y rechaza lo que no es un origen válido', () => {
    expect(leerParametroCopia(`pedido:${ID}`)).toEqual({ tipo: 'pedido', id: ID })
    expect(leerParametroCopia(null)).toBeNull()
    expect(leerParametroCopia(`factura:${ID}`)).toBeNull()
    expect(leerParametroCopia('cotizacion:no-es-un-uuid')).toBeNull()
  })

  it('el precio sólo cruza dentro del mismo lado', () => {
    expect(cruzaDeLado('cotizacion', 'pedido')).toBe(false)
    expect(cruzaDeLado('cotizacion', 'pedido_compra')).toBe(true)
    expect(cruzaDeLado('pedido_compra', 'pedido')).toBe(true)
  })
})
