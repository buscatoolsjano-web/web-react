import { describe, expect, it } from 'vitest'
import type { DefinicionAtributo } from '@/modules/catalogo/types'
import { MAXIMO_PARTES, partesDeDescripcion, type DatosProductoImpreso } from './descripcionProducto'

const def = (key: string, label: string, over: Partial<DefinicionAtributo> = {}): DefinicionAtributo => ({
  key,
  enFicha: true,
  label,
  unidad: null,
  tipo: 'text',
  filtrable: true,
  posicion: 0, enumerada: false, rango: null, opciones: [],
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
  serie: null,
  // Sin categoría conocida: vale el orden general. Los de una familia tienen
  // su propio describe, abajo.
  categoria: null,
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

/*
 * El orden por familia (Fase 82).
 *
 * «La idea es que la descripción de todos los productos sea concatenada para
 * que todos respeten el mismo orden: todos los de puntas y tubos con marca,
 * modelo, serie, encastre, largo. Y lo mismo con todas las otras categorías.»
 *
 * No hace falta una tabla nueva: `ATRIBUTOS_POR_FAMILIA` ya dice qué describe
 * a cada familia —la usa el comparador del catálogo— y es la que manda acá.
 * Dos listas de «qué describe a una punta» se separan el día que alguien toca
 * una sola.
 */
describe('cuando la familia se conoce, manda su orden', () => {
  it('una punta sale siempre en el mismo orden', () => {
    const punta = producto({
      categoria: 'punta',
      serie: 'Power Drive',
      atributos: { encastre: '1/4 HEX', largo: '50', medida: '1/4"' },
    })
    expect(texto(punta)).toBe(
      'Marca: SPEEDRILL · Modelo: 2520/10B · Tipo: Adaptador · Medida: 1/4" · Encastre: 1/4 HEX · Largo: 50 mm · Serie: Power Drive',
    )
  })

  /* Dos productos de la MISMA familia con distintos datos cargados salen en el
     mismo orden: lo que falta se saltea, no corre a los demás de lugar. */
  it('lo que falta no desordena al resto', () => {
    const sinMedida = producto({
      categoria: 'punta',
      serie: null,
      atributos: { encastre: '1/4 HEX', largo: '50' },
    })
    expect(texto(sinMedida)).toBe(
      'Marca: SPEEDRILL · Modelo: 2520/10B · Tipo: Adaptador · Encastre: 1/4 HEX · Largo: 50 mm',
    )
  })

  it('cada familia tiene lo suyo: un balanceador no tiene encastre', () => {
    const balanceador = producto({
      categoria: 'balanceador',
      tipo: null,
      atributos: { min_kg: '6', max_kg: '8', longitud: '2', carcasa: 'ALUMINIO', encastre: '1/4 HEX' },
    })
    expect(texto(balanceador)).toBe(
      'Marca: SPEEDRILL · Modelo: 2520/10B · Cap. mín.: 6 kg · Cap. máx.: 8 kg · Recorrido: 2 m · Carcasa: ALUMINIO',
    )
  })

  /*
   * El SKU no se repite. El comparador del catálogo muestra el SKU bajo el
   * título «Modelo», pero en el documento el SKU ya es la primera columna:
   * repetirlo gastaría uno de los pocos datos que entran.
   */
  it('«Modelo» es el modelo del fabricante, no el SKU', () => {
    const punta = producto({ categoria: 'punta', modelo: '2520/10B', serie: null, atributos: {} })
    expect(texto(punta)).toContain('Modelo: 2520/10B')
  })

  /* Una categoría que no está en la tabla —12.588 productos en «otros»— sigue
     con el orden general de siempre. */
  it('sin familia conocida, el orden general', () => {
    const otro = producto({ categoria: 'una-categoria-cualquiera' })
    expect(texto(otro)).toContain('Marca: SPEEDRILL')
    expect(texto(otro)).toContain('NCM: 8204.20.00')
  })
})
