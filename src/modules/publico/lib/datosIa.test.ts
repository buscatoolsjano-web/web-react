import { describe, expect, it } from 'vitest'
import { datosDeCategoria, datosDeFicha, llmsTxt, productoJson } from './datosIa'

const SITIO = 'https://app.buscatools.com'
const PUNTA = {
  nombre: 'Punta PH2 x 50 mm',
  sku: 'SP-PH2-50',
  slug: 'punta-ph2-50',
  categoriaSlug: 'puntas-y-tubos',
  categoria: 'Puntas y tubos',
  marca: 'SPEEDRILL',
  atributos: { encastre: '1/4"', largo_mm: 50, vacio: '' },
}

describe('datosDeFicha', () => {
  it('trae el producto y su miga de pan, sin precio', () => {
    const d = datosDeFicha(PUNTA, SITIO) as { '@graph': Record<string, unknown>[] }
    const [producto, miga] = d['@graph']
    expect(producto!['@type']).toBe('Product')
    expect(producto!.url).toBe(`${SITIO}/productos/puntas-y-tubos/punta-ph2-50/`)
    expect(producto).not.toHaveProperty('offers')
    expect(producto).not.toHaveProperty('@context')
    expect(miga!['@type']).toBe('BreadcrumbList')
    expect((miga!.itemListElement as unknown[]).length).toBe(4)
  })
})

describe('datosDeCategoria', () => {
  it('lista los productos con su URL', () => {
    const d = datosDeCategoria(SITIO, { nombre: 'Puntas y tubos', slug: 'puntas-y-tubos', descripcion: 'x' }, [PUNTA])
    const pagina = (d['@graph'] as Record<string, unknown>[])[0]!
    const lista = pagina.mainEntity as { numberOfItems: number; itemListElement: { url: string }[] }
    expect(lista.numberOfItems).toBe(1)
    expect(lista.itemListElement[0]!.url).toBe(`${SITIO}/productos/puntas-y-tubos/punta-ph2-50/`)
  })
})

describe('productoJson', () => {
  it('usa nombres claros y saca los atributos vacíos', () => {
    const j = productoJson(PUNTA, SITIO)
    expect(j.codigo).toBe('SP-PH2-50')
    expect(Object.values(j.atributos)).not.toContain('')
    expect(Object.keys(j.atributos).length).toBe(2)
  })
})

describe('llmsTxt', () => {
  it('arranca con el título y dice que los precios se cotizan', () => {
    const t = llmsTxt(SITIO, {
      totalProductos: 1,
      categorias: [{ nombre: 'Puntas y tubos', ruta: '/productos/puntas-y-tubos/' }],
      marcas: [],
      preguntas: [{ pregunta: '¿Facturan A?', respuesta: 'Sí.' }],
    })
    expect(t.startsWith('# Buscatools\n')).toBe(true)
    expect(t).toMatch(/precios .* NO se publican/i)
    expect(t).toContain(`(${SITIO}/productos/puntas-y-tubos/)`)
  })
})
