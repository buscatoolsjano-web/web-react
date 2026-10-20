import { describe, expect, it } from 'vitest'
import {
  esRutaPublica,
  rutaCanonica,
  rutaCatalogo,
  rutaCategoria,
  rutaProductoPublico,
} from './rutas'

describe('las URLs públicas', () => {
  it('se arman con el slug, no con el SKU escapado', () => {
    // `/catalogo/SP.2520%2F8B` era un SKU con el punto y la barra
    // convertidos en basura. Para buscar eso no sirve.
    expect(rutaProductoPublico('puntas-y-tubos', 'speedrill-ph2-phillips')).toBe(
      '/productos/puntas-y-tubos/speedrill-ph2-phillips',
    )
    expect(rutaCategoria('balanceadores')).toBe('/productos/balanceadores')
    expect(rutaCatalogo()).toBe('/productos')
  })
})

describe('qué cáscara se dibuja', () => {
  it('la raíz y todo lo que cuelga de /productos es público', () => {
    for (const p of [
      '/',
      '/productos',
      '/productos/balanceadores',
      '/productos/puntas-y-tubos/speedrill-ph2-phillips',
    ]) {
      expect(esRutaPublica(p), p).toBe(true)
    }
  })

  it('el ERP no', () => {
    // Equivocarse acá es mostrarle la barra lateral del ERP a alguien que no
    // inició sesión.
    for (const p of [
      '/inicio',
      '/catalogo',
      '/catalogo/SP.PH2',
      '/ventas/cotizaciones',
      '/auth/login',
    ]) {
      expect(esRutaPublica(p), p).toBe(false)
    }
  })

  it('una ruta que EMPIEZA igual pero es otra, tampoco', () => {
    // `/productosx` no es `/productos`: sin la barra, un `startsWith` pelado
    // se tragaría cualquier ruta nueva que empiece con esas letras.
    expect(esRutaPublica('/productosx')).toBe(false)
    expect(esRutaPublica('/productos-internos')).toBe(false)
  })
})

describe('la dirección canónica de una ficha', () => {
  const real = { categoriaSlug: 'puntas-y-tubos', slug: 'speedrill-ph2-phillips' }

  it('si la pedida ya es la buena, no manda a ningún lado', () => {
    expect(
      rutaCanonica({ categoria: 'puntas-y-tubos', producto: 'speedrill-ph2-phillips' }, real),
    ).toBeNull()
  })

  it('con la categoría equivocada, corrige', () => {
    // La base lo encuentra igual por el slug. Si eso se dejara pasar, el
    // mismo producto tendría tantas URLs como categorías haya.
    expect(rutaCanonica({ categoria: 'balanceadores', producto: 'speedrill-ph2-phillips' }, real))
      .toBe('/productos/puntas-y-tubos/speedrill-ph2-phillips')
  })
})
