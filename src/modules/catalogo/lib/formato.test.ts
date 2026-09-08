import { describe, expect, it } from 'vitest'
import {
  formatearCantidad,
  formatearPrecio,
  presentarAtributos,
  rangoVisible,
  SIN_PRECIO,
  totalDePaginas,
  valorConUnidad,
} from './formato'
import type { DefinicionAtributo } from '../types'

const DEFS: DefinicionAtributo[] = [
  { key: 'torq_max', label: 'Torque máximo', unidad: 'Nm', tipo: 'number', filtrable: true, posicion: 1 },
  { key: 'encastre', label: 'Encastre', unidad: null, tipo: 'text', filtrable: true, posicion: 2 },
  { key: 'medida', label: 'Medida', unidad: null, tipo: 'text', filtrable: true, posicion: 3 },
]

describe('formatearPrecio', () => {
  it('U3 · sin precio devuelve "Consultar", nunca "$ 0"', () => {
    // 92 de 219 productos no tienen precio: es el camino normal. Un cero se
    // leería como un precio real y sería peor que no mostrar nada.
    expect(formatearPrecio(null, 'ARS')).toBe(SIN_PRECIO)
    expect(formatearPrecio(0, 'ARS')).not.toBe(SIN_PRECIO)
    expect(formatearPrecio(NaN, 'ARS')).toBe(SIN_PRECIO)
  })

  it('sin moneda no inventa una', () => {
    expect(formatearPrecio(1234.5, null)).toBe(SIN_PRECIO)
  })

  it('formatea con la moneda de la lista, no con una fija', () => {
    const ars = formatearPrecio(1234.5, 'ARS')
    const usd = formatearPrecio(1234.5, 'USD')
    expect(ars).toMatch(/1[.,]234[.,]50/)
    expect(usd).not.toBe(ars)
  })

  it('no rompe con un código de moneda desconocido', () => {
    expect(formatearPrecio(10, 'XXXX')).toContain('10')
  })
})

describe('formatearCantidad', () => {
  it('muestra el cero y usa guión sólo para lo desconocido', () => {
    expect(formatearCantidad(0)).toBe('0')
    expect(formatearCantidad(null)).toBe('—')
  })
})

describe('presentarAtributos', () => {
  it('U4 · resuelve etiqueta y unidad en vez de mostrar el JSON crudo', () => {
    const r = presentarAtributos({ torq_max: 250 }, DEFS)
    expect(r).toHaveLength(1)
    expect(r[0]?.label).toBe('Torque máximo')
    expect(valorConUnidad(r[0]!)).toBe('250 Nm')
  })

  it('U4 · descarta claves sin definición', () => {
    // El trigger de la base impide insertarlas; si aparece una es un bug
    // que hay que ver, no algo para pintar en pantalla.
    const r = presentarAtributos({ encastre: '1/2', clave_fantasma: 'x' }, DEFS)
    expect(r.map((a) => a.key)).toEqual(['encastre'])
  })

  it('U4 · ordena por las definiciones, no por el orden del jsonb', () => {
    // El orden de las claves de un jsonb no es estable en Postgres.
    const r = presentarAtributos({ medida: '10mm', encastre: '1/2', torq_max: 5 }, DEFS)
    expect(r.map((a) => a.key)).toEqual(['torq_max', 'encastre', 'medida'])
  })

  it('descarta valores vacíos o nulos', () => {
    expect(presentarAtributos({ encastre: '', medida: null }, DEFS)).toEqual([])
  })

  it('muestra los booleanos como Sí/No', () => {
    const defs: DefinicionAtributo[] = [
      { key: 'encastre', label: 'Encastre', unidad: null, tipo: 'boolean', filtrable: false, posicion: 1 },
    ]
    expect(presentarAtributos({ encastre: true }, defs)[0]?.valor).toBe('Sí')
  })
})

describe('rangoVisible', () => {
  it('arma el texto del paginador', () => {
    expect(rangoVisible(2, 50, 216)).toBe('51–100 de 216')
    expect(rangoVisible(5, 50, 216)).toBe('201–216 de 216')
    expect(rangoVisible(1, 50, 0)).toBe('0 resultados')
  })
})

describe('totalDePaginas', () => {
  it('redondea hacia arriba y nunca devuelve cero', () => {
    expect(totalDePaginas(216, 50)).toBe(5)
    expect(totalDePaginas(0, 50)).toBe(1)
  })
})
