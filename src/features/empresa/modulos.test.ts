import { describe, expect, it } from 'vitest'
import { moduloDeRuta, rutaHabilitada, tieneModulo, PRESET_DISTRIBUIDOR } from './modulos'

describe('módulos por empresa', () => {
  it('null es «todos los módulos»', () => {
    expect(tieneModulo(null, 'facturacion')).toBe(true)
    expect(tieneModulo(undefined, 'emails')).toBe(true)
  })

  it('una lista habilita sólo esos', () => {
    expect(tieneModulo(['precios'], 'precios')).toBe(true)
    expect(tieneModulo(['precios'], 'compras')).toBe(false)
  })

  it('lo básico no pertenece a ningún módulo', () => {
    for (const ruta of ['/inicio', '/catalogo', '/catalogo/ABC', '/clientes/1', '/ventas/cotizaciones/nueva', '/configuracion/usuarios']) {
      expect(moduloDeRuta(ruta)).toBeNull()
      expect(rutaHabilitada(ruta, [])).toBe(true)
    }
  })

  it('cada ruta cae en su módulo', () => {
    expect(moduloDeRuta('/ventas/pedidos/123')).toBe('pedidos')
    expect(moduloDeRuta('/ventas/facturas')).toBe('facturacion')
    expect(moduloDeRuta('/compras/proveedores')).toBe('compras')
    expect(moduloDeRuta('/web/consultas')).toBe('web')
    // un prefijo parecido no confunde
    expect(moduloDeRuta('/precios-viejos')).toBeNull()
  })

  it('un distribuidor no entra a facturación, mails ni WhatsApp', () => {
    expect(rutaHabilitada('/ventas/facturas', PRESET_DISTRIBUIDOR)).toBe(false)
    expect(rutaHabilitada('/emails', PRESET_DISTRIBUIDOR)).toBe(false)
    expect(rutaHabilitada('/whatsapp', PRESET_DISTRIBUIDOR)).toBe(false)
    expect(rutaHabilitada('/precios', PRESET_DISTRIBUIDOR)).toBe(true)
  })
})
