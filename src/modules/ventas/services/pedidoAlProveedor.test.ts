import { describe, expect, it, vi } from 'vitest'

// El CI no tiene variables de entorno: el cliente real no se puede crear.
vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

const { estadoDelPedido } = await import('./pedidoAlProveedor')

const base = { numero: 'PDV-ERP00006', proveedor: 'Buscatools', pedidoEl: '2026-11-27' }

describe('estadoDelPedido', () => {
  it('lo que el distribuidor lee de su pedido', () => {
    expect(estadoDelPedido({ ...base, estado: 'draft', entrega: 'pending' })).toBe('recibido, a confirmar')
    expect(estadoDelPedido({ ...base, estado: 'confirmed', entrega: 'pending' })).toBe('confirmado')
    expect(estadoDelPedido({ ...base, estado: 'confirmed', entrega: 'partially_delivered' })).toBe('entregado en parte')
    expect(estadoDelPedido({ ...base, estado: 'confirmed', entrega: 'delivered' })).toBe('entregado')
    expect(estadoDelPedido({ ...base, estado: 'cancelled', entrega: null })).toBe('cancelado')
  })
})
