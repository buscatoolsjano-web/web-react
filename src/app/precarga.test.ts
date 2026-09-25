import { describe, expect, it } from 'vitest'
import { rutaQueCubre } from './precarga'

/**
 * Las mismas rutas que registra `precarga.ts`. Se repiten acá a propósito: el
 * test prueba la REGLA de coincidencia, no la lista, y así no hace falta
 * disparar los `import()` de verdad para probarla.
 */
const RUTAS = ['/catalogo', '/ventas/cotizaciones', '/clientes', '/emails', '/']

describe('qué pantalla precargar para un destino del menú', () => {
  it.each([
    ['/catalogo', '/catalogo'],
    ['/clientes', '/clientes'],
    ['/emails', '/emails'],
    ['/ventas/cotizaciones', '/ventas/cotizaciones'],
  ])('un destino exacto se precarga solo: %s', (to, esperado) => {
    expect(rutaQueCubre(to, RUTAS)).toBe(esperado)
  })

  /**
   * Lo importante: gana la más larga. `/` es prefijo de todo, así que sin esta
   * regla cualquier enlace precargaría el Dashboard en vez de su pantalla.
   */
  it('un hijo cae en su pantalla, no en la raíz', () => {
    expect(rutaQueCubre('/ventas/cotizaciones/nueva', RUTAS)).toBe('/ventas/cotizaciones')
    expect(rutaQueCubre('/clientes/CLI00715', RUTAS)).toBe('/clientes')
    expect(rutaQueCubre('/catalogo/J23-1-2H', RUTAS)).toBe('/catalogo')
  })

  it('la raíz coincide sólo exacta', () => {
    expect(rutaQueCubre('/', RUTAS)).toBe('/')
  })

  /** Un destino que no está en la lista no precarga nada — no revienta. */
  it.each(['/compras/proveedores', '/informes', '/configuracion/usuarios', '/whatsapp'])(
    'un destino que no se precarga devuelve null: %s',
    (to) => {
      expect(rutaQueCubre(to, RUTAS)).toBeNull()
    },
  )

  /** `/clientesnuevo` NO es hijo de `/clientes`: el corte es en la barra. */
  it('no confunde un destino que apenas empieza igual', () => {
    expect(rutaQueCubre('/clientesnuevo', RUTAS)).toBeNull()
    expect(rutaQueCubre('/emails-viejos', RUTAS)).toBeNull()
  })
})
