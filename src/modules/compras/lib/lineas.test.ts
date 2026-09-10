import { describe, expect, it } from 'vitest'
import {
  lineaCapitulo,
  lineaDeProducto,
  lineaLibre,
  mover,
  netoDeLinea,
  problemasDeLinea,
  renumerar,
  totalesPrevios,
} from './lineas'
import type { LineaPedidoCompra } from '../types'

const linea = (cambios: Partial<LineaPedidoCompra> = {}): LineaPedidoCompra => ({
  ...lineaLibre(1),
  nombre: 'Algo',
  cantidad: 2,
  precioUnitario: 100,
  ...cambios,
})

describe('lineaDeProducto', () => {
  it('trae el producto con su snapshot y precio en cero', () => {
    const l = lineaDeProducto({ id: 'p1', sku: 'PRO05229', nombre: 'Balanceador' }, 3)
    expect(l.productId).toBe('p1')
    expect(l.sku).toBe('PRO05229')
    expect(l.nombre).toBe('Balanceador')
    expect(l.numeroLinea).toBe(3)
    // Cero, NO el precio de venta del catálogo: en un pedido de compra el
    // precio es lo que se le paga al proveedor.
    expect(l.precioUnitario).toBe(0)
  })

  it('cada línea nace con su propio id', () => {
    const a = lineaDeProducto({ id: 'p1', sku: 'A', nombre: 'A' }, 1)
    const b = lineaDeProducto({ id: 'p1', sku: 'A', nombre: 'A' }, 2)
    expect(a.id).not.toBe(b.id)
  })
})

describe('lineaLibre', () => {
  it('no tiene producto: se compra algo que no está en el catálogo', () => {
    const l = lineaLibre(1)
    expect(l.productId).toBeNull()
    expect(l.sku).toBeNull()
    expect(l.tipoLinea).toBe('product')
  })
})

describe('lineaCapitulo', () => {
  it('nace no gravado y en cero: un título no suma', () => {
    const l = lineaCapitulo(1)
    expect(l.tipoLinea).toBe('chapter')
    expect(l.tratamientoImpuesto).toBe('not_taxed')
    expect(netoDeLinea(l)).toBe(0)
  })
})

describe('netoDeLinea', () => {
  it('cantidad × precio', () => {
    expect(netoDeLinea(linea())).toBe(200)
  })

  it('con descuento', () => {
    expect(netoDeLinea(linea({ descuentoPct: 10 }))).toBeCloseTo(180, 6)
  })

  it('un capítulo nunca suma, tenga lo que tenga', () => {
    expect(netoDeLinea(linea({ tipoLinea: 'chapter', cantidad: 99, precioUnitario: 99 }))).toBe(0)
  })

  it('sin precio cuenta como cero, no como NaN', () => {
    expect(netoDeLinea(linea({ precioUnitario: null }))).toBe(0)
  })
})

describe('renumerar y mover', () => {
  const tres = [lineaLibre(1), lineaLibre(2), lineaLibre(3)]

  it('renumera 1..n', () => {
    const revueltas = [tres[2]!, tres[0]!, tres[1]!]
    expect(renumerar(revueltas).map((l) => l.numeroLinea)).toEqual([1, 2, 3])
  })

  it('mover cambia el orden y renumera', () => {
    const movidas = mover(tres, tres[2]!.id, -1)
    expect(movidas.map((l) => l.id)).toEqual([tres[0]!.id, tres[2]!.id, tres[1]!.id])
    expect(movidas.map((l) => l.numeroLinea)).toEqual([1, 2, 3])
  })

  it('mover fuera de rango no rompe nada', () => {
    expect(mover(tres, tres[0]!.id, -1).map((l) => l.id)).toEqual(tres.map((l) => l.id))
    expect(mover(tres, tres[2]!.id, 1).map((l) => l.id)).toEqual(tres.map((l) => l.id))
  })

  it('la identidad es el id, no la posición', () => {
    const movidas = mover(tres, tres[1]!.id, 1)
    // La línea que estaba segunda sigue siendo la misma línea, con otro número.
    const misma = movidas.find((l) => l.id === tres[1]!.id)
    expect(misma).toBeDefined()
    expect(misma!.numeroLinea).toBe(3)
  })
})

describe('totalesPrevios', () => {
  it('suma netos e IVA por línea con su propia alícuota', () => {
    const t = totalesPrevios([
      linea({ cantidad: 10, precioUnitario: 100, tratamientoImpuesto: 'vat_21', tasaImpuesto: 21 }),
      linea({ cantidad: 10, precioUnitario: 100, tratamientoImpuesto: 'vat_105', tasaImpuesto: 10.5 }),
    ])
    expect(t.subtotal).toBe(2000)
    // 1000 × 21 % + 1000 × 10,5 % — no un 21 % parejo sobre el total.
    expect(t.impuesto).toBe(315)
    expect(t.total).toBe(2315)
  })

  it('el descuento sale de restar: no hay columna de descuento', () => {
    const t = totalesPrevios([linea({ cantidad: 10, precioUnitario: 100, descuentoPct: 20 })])
    expect(t.bruto).toBe(1000)
    expect(t.descuento).toBe(200)
    expect(t.subtotal).toBe(800)
  })

  it('un exento no paga impuesto', () => {
    const t = totalesPrevios([
      linea({ cantidad: 1, precioUnitario: 500, tratamientoImpuesto: 'exempt', tasaImpuesto: 0 }),
    ])
    expect(t.subtotal).toBe(500)
    expect(t.impuesto).toBe(0)
    expect(t.total).toBe(500)
  })

  it('los capítulos no entran en ninguna cuenta', () => {
    const t = totalesPrevios([
      lineaCapitulo(1),
      linea({ cantidad: 1, precioUnitario: 100, tasaImpuesto: 21 }),
    ])
    expect(t.subtotal).toBe(100)
    expect(t.impuesto).toBe(21)
  })

  it('sin líneas, todo en cero', () => {
    expect(totalesPrevios([])).toEqual({
      bruto: 0,
      descuento: 0,
      subtotal: 0,
      impuesto: 0,
      total: 0,
    })
  })
})

describe('problemasDeLinea', () => {
  it('una línea de producto bien cargada no tiene problemas', () => {
    expect(problemasDeLinea(linea())).toEqual([])
  })

  it('una línea libre sin nada que la identifique', () => {
    const l = linea({ nombre: null, sku: null })
    expect(problemasDeLinea(l)[0]).toContain('referencia')
  })

  it('cantidad cero o negativa', () => {
    expect(problemasDeLinea(linea({ cantidad: 0 }))[0]).toContain('mayor que cero')
    expect(problemasDeLinea(linea({ cantidad: -1 }))[0]).toContain('mayor que cero')
  })

  it('descuento fuera de rango', () => {
    expect(problemasDeLinea(linea({ descuentoPct: 101 }))[0]).toContain('entre 0 y 100')
  })

  it('«otra alícuota» sin alícuota', () => {
    const l = linea({ tratamientoImpuesto: 'other', tasaImpuesto: null })
    expect(problemasDeLinea(l)[0]).toContain('cuál')
  })

  it('«otra alícuota» con alícuota escrita está bien', () => {
    expect(problemasDeLinea(linea({ tratamientoImpuesto: 'other', tasaImpuesto: 5 }))).toEqual([])
  })

  it('un capítulo sólo necesita título', () => {
    expect(problemasDeLinea(lineaCapitulo(1))).toEqual([])
    expect(problemasDeLinea({ ...lineaCapitulo(1), nombre: '  ' })[0]).toContain('título')
  })
})
