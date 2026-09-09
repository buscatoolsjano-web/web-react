import { describe, expect, it } from 'vitest'
import { filtrarAtributosDeCategoria } from './facetas'
import type { DefinicionAtributo } from '../types'

const def = (key: string, filtrable = true): DefinicionAtributo => ({
  key,
  label: key,
  unidad: null,
  tipo: 'text',
  filtrable,
  posicion: 0,
})

const DEFS = [
  def('encastre'),
  def('largo'),
  def('medida'),
  def('min_kg'),
  def('max_kg'),
  def('carcasa'),
  def('sufijos', false), // no filtrable
]

// Recorte real de product_attribute_categories.
const PUNTAS = 'cat-puntas'
const BALANCEADORES = 'cat-balanceadores'
const VACIA = 'cat-sin-relaciones'

const MAPA = new Map<string, Set<string>>([
  [PUNTAS, new Set(['encastre', 'largo', 'medida', 'sufijos'])],
  [BALANCEADORES, new Set(['min_kg', 'max_kg', 'carcasa', 'medida'])],
])

describe('filtrarAtributosDeCategoria', () => {
  it('sin categoría elegida devuelve todos los filtrables', () => {
    // No hay forma de saber cuáles aplican, así que se ofrecen todos.
    const r = filtrarAtributosDeCategoria(DEFS, null, MAPA)
    expect(r.map((d) => d.key)).toEqual([
      'encastre', 'largo', 'medida', 'min_kg', 'max_kg', 'carcasa',
    ])
  })

  it('con categoría devuelve sólo los suyos', () => {
    const r = filtrarAtributosDeCategoria(DEFS, PUNTAS, MAPA)
    expect(r.map((d) => d.key)).toEqual(['encastre', 'largo', 'medida'])
  })

  it('nunca ofrece un atributo no filtrable, aunque aplique a la categoría', () => {
    // `sufijos` está en la relación N:N de Puntas pero is_filterable = false.
    const r = filtrarAtributosDeCategoria(DEFS, PUNTAS, MAPA)
    expect(r.map((d) => d.key)).not.toContain('sufijos')
  })

  it('el mismo atributo puede aplicar a dos categorías — el caso que la FK escalar no podía', () => {
    const puntas = filtrarAtributosDeCategoria(DEFS, PUNTAS, MAPA).map((d) => d.key)
    const balan = filtrarAtributosDeCategoria(DEFS, BALANCEADORES, MAPA).map((d) => d.key)
    expect(puntas).toContain('medida')
    expect(balan).toContain('medida')
    // Y los conjuntos se superponen sin contenerse: por eso hace falta N:N.
    expect(puntas).toContain('encastre')
    expect(balan).not.toContain('encastre')
    expect(balan).toContain('min_kg')
    expect(puntas).not.toContain('min_kg')
  })

  it('categoría sin relaciones cargadas cae a mostrarlos todos, no a ninguno', () => {
    // Preferimos un filtro de más que una pantalla sin filtros.
    const r = filtrarAtributosDeCategoria(DEFS, VACIA, MAPA)
    expect(r).toHaveLength(6)
  })

  it('sin el mapa todavía cargado no rompe', () => {
    const r = filtrarAtributosDeCategoria(DEFS, PUNTAS, undefined)
    expect(r).toHaveLength(6)
  })
})
