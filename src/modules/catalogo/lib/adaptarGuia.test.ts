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

  it('las categorías llevan su conteo por id (0 si no está en las facetas)', () => {
    const cats: CategoriaResumen[] = [
      { id: 'c-punta', nombre: 'Puntas y tubos', slug: 'punta', necesitaRevision: false },
      { id: 'c-bal', nombre: 'Balanceadores', slug: 'balanceador', necesitaRevision: false },
    ]
    const r = categoriasParaGuia(cats, facetas)
    expect(r).toEqual([
      { slug: 'punta', nombre: 'Puntas y tubos', productos: 9 },
      { slug: 'balanceador', nombre: 'Balanceadores', productos: 0 },
    ])
  })

  it('los atributos multi-valor del ERP quedan de a uno', () => {
    expect(atributosParaGuia({ encastre: ['1/4'], largo: [], medida: ['5'] })).toEqual({ encastre: '1/4', medida: '5' })
  })
})
