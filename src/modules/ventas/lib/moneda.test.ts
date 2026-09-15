import { describe, expect, it, vi } from 'vitest'
import { CODIGO_MONEDA_REQUERIDA, MONEDAS_DOCUMENTO, exigirMoneda } from './moneda'

// El servicio importa el cliente de Supabase; la regla de precio no lo usa.
vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
const { precioSugerido } = await import('../services/productosParaLinea')

describe('moneda del documento (Fase 14 E3)', () => {
  it('sin moneda corta con el código estable; nunca completa USD', () => {
    for (const vacia of [null, undefined, '', '  ']) {
      expect(() => exigirMoneda(vacia)).toThrow(CODIGO_MONEDA_REQUERIDA)
    }
    expect(exigirMoneda('ARS')).toBe('ARS')
  })

  it('las monedas son las de la tabla currencies', () => {
    expect([...MONEDAS_DOCUMENTO]).toEqual(['USD', 'ARS', 'EUR'])
  })

  it('un precio de lista en otra moneda no se sugiere (FX_POLICY = UNDEFINED)', () => {
    const p = { id: 'x', sku: 'A', nombre: 'A', marca: null, precio: 100, monedaPrecio: 'USD' }
    expect(precioSugerido(p, 'USD')).toBe(100)
    expect(precioSugerido(p, 'ARS')).toBeNull()
    expect(precioSugerido(p, '')).toBeNull()
    expect(precioSugerido({ ...p, precio: null }, 'USD')).toBeNull()
  })
})
