import { describe, expect, it } from 'vitest'
import { rutaProducto } from './rutas'

describe('la ruta de la ficha de un producto', () => {
  it('es /catalogo con el SKU', () => {
    expect(rutaProducto('CP.CP9911')).toBe('/catalogo/CP.CP9911')
  })

  /*
   * El caso que importa: los SKU de este catálogo tienen barras
   * —`SP.2520/8B`— y sin escapar, la barra parte la URL en dos segmentos y el
   * router no encuentra la ficha.
   */
  it('escapa la barra, que si no parte la URL', () => {
    expect(rutaProducto('SP.2520/8B')).toBe('/catalogo/SP.2520%2F8B')
  })

  it('escapa los espacios y los acentos', () => {
    expect(rutaProducto('FI.(BAJO PLANO)')).toBe('/catalogo/FI.(BAJO%20PLANO)')
    expect(rutaProducto('XX.AÑO')).toBe('/catalogo/XX.A%C3%91O')
  })
})
