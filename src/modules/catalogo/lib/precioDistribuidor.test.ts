import { describe, expect, it } from 'vitest'
import { AJUSTES_POR_DEFECTO, margenPara, monedaDeVenta, precioDeVenta } from './precioDistribuidor'

const ajustes = { margenPct: 35, margenesRubro: { puntas: 50 }, monedaVenta: 'ARS', tipoCambio: 1450 }

describe('precio de venta del distribuidor', () => {
  it('sin ajustes vende a su costo, en la moneda del proveedor', () => {
    expect(precioDeVenta(100, null, 'USD', AJUSTES_POR_DEFECTO)).toBe(100)
    expect(monedaDeVenta('USD', AJUSTES_POR_DEFECTO)).toBe('USD')
  })

  it('el margen del rubro gana al general', () => {
    expect(margenPara('puntas', ajustes)).toBe(50)
    expect(margenPara('otro', ajustes)).toBe(35)
    expect(margenPara(null, ajustes)).toBe(35)
  })

  it('aplica el margen y lo pasa a su moneda', () => {
    // 100 USD + 35 % = 135 USD × 1450 = 195.750 ARS
    expect(precioDeVenta(100, null, 'USD', ajustes)).toBe(195750)
    // rubro con 50 %: 150 USD × 1450
    expect(precioDeVenta(100, 'puntas', 'USD', ajustes)).toBe(217500)
  })

  it('en la moneda del proveedor, con margen y sin convertir', () => {
    expect(precioDeVenta(100, null, 'USD', ajustes, 'USD')).toBe(135)
  })

  it('en otra moneda no inventa un precio', () => {
    expect(precioDeVenta(100, null, 'USD', ajustes, 'EUR')).toBeNull()
  })

  it('sin costo no hay precio', () => {
    expect(precioDeVenta(null, null, 'USD', ajustes)).toBeNull()
  })

  it('redondea a centavos', () => {
    expect(precioDeVenta(10.005, null, 'USD', { ...AJUSTES_POR_DEFECTO, margenPct: 33.333 })).toBe(13.34)
  })
})
