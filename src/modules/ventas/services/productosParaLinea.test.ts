import { describe, expect, it, vi } from 'vitest'

// El módulo importa el cliente de Supabase; estas reglas no lo usan.
vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

const { motivoPrecio, precioSugerido, precioVigente, textoMotivoPrecio } = await import('./productosParaLinea')

/**
 * El precio sugerido de una línea nueva (Fase 15 · E3).
 *
 * La regla en una línea: el precio sale de la TARIFA DEL DOCUMENTO, en la
 * misma moneda, o no sale. Nunca se cae a otra lista ni se convierte.
 */

const producto = (p: Partial<Parameters<typeof precioSugerido>[0]> = {}) => ({
  id: 'p1',
  sku: 'PRO001',
  nombre: 'ZZ Balanceador',
  marca: 'ZZ Marca',
  precio: 100,
  monedaPrecio: 'USD',
  tarifaId: 'mayorista',
  tarifaNombre: 'Mayorista',
  ...p,
})

describe('precio vigente de una tarifa', () => {
  const hoy = '2026-09-17'

  it('toma el de la lista pedida, no el de otra', () => {
    const filas = [
      { amount: 50, price_list_id: 'base', valid_from: '2026-01-01', valid_to: null },
      { amount: 40, price_list_id: 'mayorista', valid_from: '2026-01-01', valid_to: null },
    ]
    expect(precioVigente(filas, 'mayorista', hoy)).toBe(40)
    expect(precioVigente(filas, 'base', hoy)).toBe(50)
  })

  it('sin fila en esa lista, no hay precio', () => {
    expect(precioVigente([{ amount: 50, price_list_id: 'base', valid_from: '2026-01-01', valid_to: null }], 'mayorista', hoy)).toBeNull()
    expect(precioVigente([], 'mayorista', hoy)).toBeNull()
  })

  it('respeta la vigencia: ni la futura ni la vencida si hay una vigente', () => {
    const filas = [
      { amount: 10, price_list_id: 'l', valid_from: '2025-01-01', valid_to: '2026-01-01' },
      { amount: 20, price_list_id: 'l', valid_from: '2026-02-01', valid_to: null },
      { amount: 30, price_list_id: 'l', valid_from: '2027-01-01', valid_to: null },
    ]
    expect(precioVigente(filas, 'l', hoy)).toBe(20)
  })

  it('si ninguna rige hoy, la última que empezó; una futura nunca', () => {
    const filas = [
      { amount: 10, price_list_id: 'l', valid_from: '2024-01-01', valid_to: '2024-12-31' },
      { amount: 15, price_list_id: 'l', valid_from: '2025-01-01', valid_to: '2025-12-31' },
      { amount: 99, price_list_id: 'l', valid_from: '2030-01-01', valid_to: null },
    ]
    expect(precioVigente(filas, 'l', hoy)).toBe(15)
  })
})

describe('motivo del precio sugerido', () => {
  it('tarifa del documento en la misma moneda: se sugiere', () => {
    const p = producto()
    expect(motivoPrecio(p, 'USD')).toBe('ok')
    expect(precioSugerido(p, 'USD')).toBe(100)
    expect(textoMotivoPrecio('ok', p, 'USD')).toBeNull()
  })

  it('sin precio en la tarifa: sin precio y con el motivo, nunca el de otra lista', () => {
    const p = producto({ precio: null })
    expect(motivoPrecio(p, 'USD')).toBe('sin_precio_en_tarifa')
    expect(precioSugerido(p, 'USD')).toBeNull()
    expect(textoMotivoPrecio('sin_precio_en_tarifa', p, 'USD')).toBe(
      'Este producto no tiene precio en la tarifa seleccionada (Mayorista).',
    )
  })

  it('tarifa en otra moneda: no se aplica ni se convierte', () => {
    const p = producto({ monedaPrecio: 'ARS', tarifaNombre: 'Lista ARS' })
    expect(motivoPrecio(p, 'USD')).toBe('otra_moneda')
    expect(precioSugerido(p, 'USD')).toBeNull()
    expect(textoMotivoPrecio('otra_moneda', p, 'USD')).toMatch(/está en ARS y el documento en USD/)
  })

  it('documento sin moneda: todavía no se sugiere nada', () => {
    expect(precioSugerido(producto(), '')).toBeNull()
  })

  it('empresa sin lista por defecto y documento sin tarifa: se dice', () => {
    const p = producto({ tarifaId: null, tarifaNombre: null, precio: null, monedaPrecio: null })
    expect(motivoPrecio(p, 'USD')).toBe('sin_tarifa')
    expect(textoMotivoPrecio('sin_tarifa', p, 'USD')).toMatch(/no tiene lista de precios por defecto/)
  })
})
