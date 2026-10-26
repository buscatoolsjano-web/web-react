import { describe, expect, it } from 'vitest'
import { atributosParaGuia, categoriasParaGuia, facetasParaGuia } from './adaptarGuia'
import type { CategoriaResumen, Facetas } from '../types'

const facetas: Facetas = {
  total: 9,
  totalCatalogo: 100,
  marcas: [{ valor: 'm1', etiqueta: 'APEX', cantidad: 5 }],
  categorias: [{ valor: 'c-punta', etiqueta: 'Puntas y tubos', cantidad: 9 }],
  subtipos: [{ valor: 'Phillips', etiqueta: 'Phillips (3)', cantidad: 3 }],
  series: [{ valor: '23', etiqueta: '23', cantidad: 2 }],
  atributos: [
    {
      key: 'encastre', label: 'Encastre', unidad: null, clase: 'enum',
      opciones: [{ valor: '1/4', etiqueta: '1/4', cantidad: 4 }], min: null, max: null,
    },
  ],
}

describe('adaptarGuia (Fase 133)', () => {
  it('mapea las facetas del ERP a la forma pública (subtipos → tipos por su valor)', () => {
    const r = facetasParaGuia(facetas)!
    expect(r.total).toBe(9)
    // El tipo va por su NOMBRE (el valor), no la etiqueta con conteo.
    expect(r.tipos).toEqual([{ slug: 'Phillips', nombre: 'Phillips', cuantos: 3 }])
    expect(r.atributos[0]).toMatchObject({ key: 'encastre', opciones: [{ valor: '1/4', cuantos: 4 }] })
  })

  it('las categorías llevan su conteo por id y hablan en slug público, con su portada', () => {
    const cats: CategoriaResumen[] = [
      { id: 'c-punta', nombre: 'Puntas y tubos', slug: 'punta', slugPublico: 'puntas-y-tubos', necesitaRevision: false },
      { id: 'c-bal', nombre: 'Balanceadores', slug: 'balanceador', slugPublico: null, necesitaRevision: false },
    ]
    // Las portadas van por slug público: la foto del ERP es la MISMA que la web.
    const portadas = new Map([['puntas-y-tubos', 'https://foto/punta.jpg']])
    const r = categoriasParaGuia(cats, facetas, portadas)
    expect(r).toEqual([
      // «punta» → «puntas-y-tubos», y trae la portada; el conteo por id.
      { slug: 'puntas-y-tubos', nombre: 'Puntas y tubos', productos: 9, portadaUrl: 'https://foto/punta.jpg' },
      // Sin slug público cae al propio; sin portada queda en null (la guía usa el ícono).
      { slug: 'balanceador', nombre: 'Balanceadores', productos: 0, portadaUrl: null },
    ])
  })

  it('los atributos multi-valor del ERP quedan de a uno', () => {
    expect(atributosParaGuia({ encastre: ['1/4'], largo: [], medida: ['5'] })).toEqual({ encastre: '1/4', medida: '5' })
  })
})
