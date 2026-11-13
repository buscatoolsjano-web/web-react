import { describe, expect, it } from 'vitest'
import { GUIAS, esGenerica, textoDeMarca } from './contenidos'
import { esRutaPublica } from './rutas'

describe('textoDeMarca', () => {
  it('usa el texto propio de una marca conocida', () => {
    expect(textoDeMarca('tecna', 'TECNA', 292, ['Balanceadores']).bajada).toMatch(/Italia/)
  })

  it('arma uno con el catálogo para las demás, sin inventar origen', () => {
    const t = textoDeMarca('gedore', 'GEDORE', 98, ['Herramientas manuales', 'Accesorios'])
    expect(t.bajada).toBe('98 productos de GEDORE en Herramientas manuales y Accesorios.')
    expect(t.parrafos.join(' ')).not.toMatch(/fabricad|origen|país/i)
  })
})

describe('esGenerica', () => {
  it('reconoce «Genérico» con o sin tilde', () => {
    expect(esGenerica('Genérico')).toBe(true)
    expect(esGenerica('generico')).toBe(true)
    expect(esGenerica('GEDORE')).toBe(false)
  })
})

describe('guías de categoría', () => {
  it('cada guía tiene criterios', () => {
    for (const [slug, g] of Object.entries(GUIAS)) {
      expect(g.criterios.length, slug).toBeGreaterThan(0)
    }
  })
})

describe('esRutaPublica', () => {
  it('incluye marcas e institucionales, no el ERP', () => {
    for (const p of ['/', '/productos', '/marcas', '/marcas/tecna', '/nosotros', '/servicios', '/contacto']) {
      expect(esRutaPublica(p), p).toBe(true)
    }
    for (const p of ['/inicio', '/catalogo', '/ventas/cotizaciones', '/configuracion/marcas']) {
      expect(esRutaPublica(p), p).toBe(false)
    }
  })
})
