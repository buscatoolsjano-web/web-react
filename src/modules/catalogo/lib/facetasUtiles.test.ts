import { describe, expect, it } from 'vitest'
import { facetaSirveParaFiltrar } from './clasificarFaceta'
import { necesitaFacetasDeAtributo } from './planDeConsulta'
import type { FacetaAtributo, FiltrosCatalogo } from '../types'

/**
 * Dos reglas de la Fase 60, las dos salidas del mismo pedido: que los filtros
 * del catálogo sean rápidos e intuitivos.
 */

const enum_ = (vals: string[]): FacetaAtributo => ({
  key: 'encastre',
  label: 'Encastre',
  unidad: null,
  clase: 'enum',
  opciones: vals.map((v) => ({ valor: v, etiqueta: v, cantidad: 1 })),
  min: null,
  max: null,
})

const rango = (min: number | null, max: number | null): FacetaAtributo => ({
  key: 'torq_min',
  label: 'Torque',
  unidad: 'Nm',
  clase: 'range',
  opciones: [],
  min,
  max,
})

describe('un filtro con una sola opción no es un filtro', () => {
  /*
   * EL PEDIDO. «Si voy a Balanceadores, en su categoría sólo aparece
   * Balanceadores. Si es sólo uno, ¿qué vas a filtrar si es sólo eso?».
   * Elegirlo deja los mismos productos que ya están en pantalla.
   */
  it('con una sola opción no se ofrece; con dos sí', () => {
    expect(facetaSirveParaFiltrar(enum_(['1/4"']), false)).toBe(false)
    expect(facetaSirveParaFiltrar(enum_(['1/4"', '1/2"']), false)).toBe(true)
  })

  it('sin ninguna opción tampoco', () => {
    expect(facetaSirveParaFiltrar(enum_([]), false)).toBe(false)
  })

  /*
   * EL QUE YA ESTÁ ELEGIDO SE MUESTRA IGUAL. Si desapareciera por quedarle
   * una sola opción, el filtro quedaría puesto sin ningún lugar desde donde
   * soltarlo: la lista mostraría menos productos y nada explicaría por qué.
   */
  it('el que está elegido se muestra aunque le quede una sola opción', () => {
    expect(facetaSirveParaFiltrar(enum_(['1/4"']), true)).toBe(true)
    expect(facetaSirveParaFiltrar(enum_([]), true)).toBe(true)
  })

  /* «De 5 a 5» no parte nada: es el mismo caso que una sola opción. */
  it('un rango con los dos extremos iguales no filtra', () => {
    expect(facetaSirveParaFiltrar(rango(5, 5), false)).toBe(false)
    expect(facetaSirveParaFiltrar(rango(5, 120), false)).toBe(true)
  })

  it('un rango sin extremos no se puede mover', () => {
    expect(facetaSirveParaFiltrar(rango(null, null), false)).toBe(false)
    expect(facetaSirveParaFiltrar(rango(5, null), false)).toBe(false)
  })
})

const filtros = (p: Partial<FiltrosCatalogo> = {}): FiltrosCatalogo => ({
  q: '',
  categoria: null,
  marca: null,
  serie: null,
  subtipos: [],
  atributos: {},
  rangos: {},
  pagina: 1,
  porPagina: 25,
  orden: 'nombre',
  ...p,
})

describe('cuándo hace falta la faceta de atributos', () => {
  /*
   * ES LA MITAD DEL TIEMPO DE LA CONSULTA. Calcularla cuesta 100 de los
   * 160 ms —hay que expandir el jsonb de 21.806 productos en 33.342 pares—, y
   * en la carga inicial la pantalla no dibuja ni un desplegable de atributos.
   */
  it('sin nada elegido no hace falta: es la carga inicial', () => {
    expect(necesitaFacetasDeAtributo(filtros())).toBe(false)
  })

  it('con una categoría sí: es cuando se dibujan los desplegables', () => {
    expect(necesitaFacetasDeAtributo(filtros({ categoria: 'c1' }))).toBe(true)
  })

  /*
   * Un enlace compartido puede traer una marca o un atributo SIN categoría.
   * Ahí la fila tiene que estar igual, o el filtro quedaría puesto sin forma
   * de editarlo.
   */
  it('con marca, atributo o rango sin categoría, también', () => {
    expect(necesitaFacetasDeAtributo(filtros({ marca: 'm1' }))).toBe(true)
    expect(necesitaFacetasDeAtributo(filtros({ atributos: { encastre: ['1/4'] } }))).toBe(true)
    expect(necesitaFacetasDeAtributo(filtros({ rangos: { torq_min: { min: 2, max: null } } }))).toBe(true)
  })

  /* Una búsqueda sola no abre la fila de desplegables, así que tampoco pide
     los atributos: buscar tiene que ser lo más rápido de la pantalla. */
  it('una búsqueda sola no los pide', () => {
    expect(necesitaFacetasDeAtributo(filtros({ q: 'torque' }))).toBe(false)
  })
})
