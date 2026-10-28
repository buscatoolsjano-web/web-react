import { describe, expect, it } from 'vitest'
import { atributosParaGuia, categoriasParaGuia, facetasParaGuia } from './adaptarGuia'
import type { CategoriaResumen, Facetas } from '../types'
import type { CategoriaPublica } from '@/modules/publico/services/catalogoPublico'

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

  it('matchea las fotos por NOMBRE: sin slug público propio igual encuentra portada y slug de foto', () => {
    const cats: CategoriaResumen[] = [
      // Con slug público propio (como Buscatools).
      { id: 'c-punta', nombre: 'Puntas y tubos', slug: 'punta', slugPublico: 'puntas-y-tubos', necesitaRevision: false },
      // SIN slug público (como Torquetools): el round-trip cae al slug singular,
      // pero la foto se resuelve por nombre contra el catálogo público.
      { id: 'c-bal', nombre: 'Balanceadores', slug: 'balanceador', slugPublico: null, necesitaRevision: false },
    ]
    const publicas: CategoriaPublica[] = [
      { slug: 'puntas-y-tubos', nombre: 'Puntas y tubos', productos: 9, portadaUrl: 'https://foto/punta.jpg' },
      { slug: 'balanceadores', nombre: 'Balanceadores', productos: 5, portadaUrl: 'https://foto/bal.jpg' },
    ]
    const r = categoriasParaGuia(cats, facetas, publicas)
    expect(r).toEqual([
      // El slug del round-trip es el público; la foto y el fotoSlug, por nombre.
      { slug: 'puntas-y-tubos', nombre: 'Puntas y tubos', productos: 9, portadaUrl: 'https://foto/punta.jpg', fotoSlug: 'puntas-y-tubos' },
      // Round-trip por el slug singular, PERO la portada y el slug de foto
      // (plural) salen del match por nombre: así Torquetools ve la misma foto.
      { slug: 'balanceador', nombre: 'Balanceadores', productos: 0, portadaUrl: 'https://foto/bal.jpg', fotoSlug: 'balanceadores' },
    ])
  })

  it('los atributos multi-valor del ERP quedan de a uno', () => {
    expect(atributosParaGuia({ encastre: ['1/4'], largo: [], medida: ['5'] })).toEqual({ encastre: '1/4', medida: '5' })
  })
})
