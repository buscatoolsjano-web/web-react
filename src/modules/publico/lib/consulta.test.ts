import { describe, expect, it, vi } from 'vitest'

// `consulta` importa el service del catálogo, que importa el cliente de
// Supabase (valida las env al cargar). En la suite aislada no hay env, así que
// se moquea el cliente: acá sólo se prueban funciones puras que no lo usan.
vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

import {
  claveFacetas,
  claveListar,
  hayFiltro,
  leerFiltros,
  leerPagina,
} from './consulta'

const p = (q: string) => new URLSearchParams(q)

describe('leerFiltros', () => {
  it('toma la categoría de la ruta, no de la query', () => {
    expect(leerFiltros(p(''), 'puntas-y-tubos').categoria).toBe('puntas-y-tubos')
    expect(leerFiltros(p(''), undefined).categoria).toBeNull()
  })

  it('lee marca, serie, tipo, modelo y texto; vacío cuando no están', () => {
    const f = leerFiltros(p('marca=tecna&serie=s1&tipo=t1&modelo=m1&q=hola'), undefined)
    expect(f).toMatchObject({ marca: 'tecna', serie: 's1', tipo: 't1', modelo: 'm1', texto: 'hola' })
    expect(leerFiltros(p(''), undefined)).toMatchObject({ marca: '', serie: '', tipo: '', modelo: '', texto: '' })
  })

  it('junta los atributos con prefijo y descarta los vacíos', () => {
    const f = leerFiltros(p('a.encastre=1%2F4&a.medida=&otro=x'), undefined)
    expect(f.atributos).toEqual({ encastre: '1/4' })
  })
})

describe('leerPagina', () => {
  it('nunca es menor que uno', () => {
    expect(leerPagina(p(''))).toBe(1)
    expect(leerPagina(p('p=3'))).toBe(3)
    expect(leerPagina(p('p=0'))).toBe(1)
    expect(leerPagina(p('p=basura'))).toBe(1)
  })
})

describe('hayFiltro', () => {
  it('es falso sin nada puesto y verdadero con cualquier filtro', () => {
    expect(hayFiltro(leerFiltros(p(''), undefined))).toBe(false)
    // La categoría va en la ruta, no cuenta como filtro de la lista.
    expect(hayFiltro(leerFiltros(p(''), 'puntas'))).toBe(false)
    expect(hayFiltro(leerFiltros(p('marca=tecna'), undefined))).toBe(true)
    expect(hayFiltro(leerFiltros(p('a.encastre=1%2F4'), undefined))).toBe(true)
  })
})

describe('las claves no cambian de forma', () => {
  // El layout adelanta estas consultas y la página las reusa: si estas claves
  // dejaran de coincidir, cada una pediría por su lado y se perdería el adelanto.
  it('facetas y listar tienen el orden y las piezas esperadas', () => {
    const f = leerFiltros(p('marca=tecna&a.encastre=1%2F4'), 'puntas')
    expect(claveFacetas(f)).toEqual([
      'catalogo-publico', 'facetas', 'puntas', 'tecna', '', '', '', '', { encastre: '1/4' }, {},
    ])
    expect(claveListar(f, 2)).toEqual([
      'catalogo-publico', 'listar', 'puntas', 'tecna', '', '', '', '', { encastre: '1/4' }, {}, 2,
    ])
  })
})
