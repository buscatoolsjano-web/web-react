import { describe, expect, it } from 'vitest'
import type { DefinicionAtributo } from '@/modules/catalogo/types'
import { MAXIMO_PARTES, partesDeDescripcion, type DatosProductoImpreso } from './descripcionProducto'

const def = (key: string, label: string, over: Partial<DefinicionAtributo> = {}): DefinicionAtributo => ({
  key,
  label,
  unidad: null,
  tipo: 'text',
  filtrable: true,
  posicion: 0,
  ...over,
})

const DEFS: DefinicionAtributo[] = [
  def('tipo_punta', 'Tipo de punta'),
  def('medida', 'Medida'),
  def('encastre', 'Encastre'),
  def('largo', 'Largo', { unidad: 'mm' }),
  def('catalogo_id', 'Catálogo', { filtrable: false }),
]

const producto = (over: Partial<DatosProductoImpreso> = {}): DatosProductoImpreso => ({
  foto: null,
  marca: 'SPEEDRILL',
  modelo: '2520/10B',
  origen: 'ESPAÑA',
  ncm: '8204.20.00',
  tipo: 'Adaptador',
  atributos: { encastre: '1/4 HEX', largo: '250', medida: '10' },
  ...over,
})

const texto = (datos: DatosProductoImpreso | undefined) =>
  partesDeDescripcion(datos, DEFS)
    .map((p) => `${p.etiqueta}: ${p.valor}`)
    .join(' · ')

describe('la descripción de una línea del documento', () => {
  /** El orden es el del sistema anterior (`app.js:25420`). */
  it('empieza por marca, modelo, origen, NCM y tipo', () => {
    expect(texto(producto())).toMatch(
      /^Marca: SPEEDRILL · Modelo: 2520\/10B · Origen: ESPAÑA · NCM: 8204\.20\.00 · Tipo: Adaptador/,
    )
  })

  it('sigue con los atributos que distinguen al producto, con su unidad', () => {
    expect(texto(producto())).toContain('Medida: 10')
    expect(texto(producto())).toContain('Encastre: 1/4 HEX')
    expect(texto(producto())).toContain('Largo: 250 mm')
  })

  /**
   * El legacy tiene un mapa escrito a mano por categoría; acá manda
   * `is_filterable`, que es el dato. Los de gestión —el id del catálogo, la
   * página— no describen el producto y en un documento que ve el cliente
   * sobran.
   */
  it('no muestra los atributos de gestión', () => {
    const d = producto({ atributos: { encastre: '1/4 HEX', catalogo_id: 'SPEEDRILL-2024' } })
    expect(texto(d)).toContain('Encastre')
    expect(texto(d)).not.toContain('Catálogo')
  })

  it('un dato que falta no deja el hueco ni la etiqueta', () => {
    const d = producto({ modelo: null, origen: '  ', ncm: null, atributos: {} })
    expect(texto(d)).toBe('Marca: SPEEDRILL · Tipo: Adaptador')
  })

  it('sin producto no inventa nada', () => {
    expect(partesDeDescripcion(undefined, DEFS)).toEqual([])
  })

  // El corte visual son tres renglones; el HTML igual llevaría todo, y con
  // veinte atributos el navegador maqueta veinte para mostrar tres.
  it('corta en un máximo de datos', () => {
    const muchos = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`a${i}`, `v${i}`]))
    const defs = Object.keys(muchos).map((k) => def(k, k.toUpperCase()))
    expect(partesDeDescripcion(producto({ atributos: muchos }), defs)).toHaveLength(MAXIMO_PARTES)
  })

  it('un atributo que no es un escalar se descarta en vez de mostrarse como objeto', () => {
    const d = producto({ atributos: { encastre: { raro: true }, medida: '10' } })
    expect(texto(d)).toContain('Medida: 10')
    expect(texto(d)).not.toContain('Encastre')
    expect(texto(d)).not.toContain('object')
  })
})
