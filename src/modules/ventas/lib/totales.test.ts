import { describe, expect, it } from 'vitest'
import { netoDeLinea, netoDeLineas, totalesPrevios } from './totales'
import type { LineaDocumento } from '../types'

const linea = (p: Partial<LineaDocumento>): LineaDocumento => ({
  id: p.id ?? 'l',
  numeroLinea: 1,
  tipoLinea: 'item',
  productId: null,
  sku: null,
  nombre: null,
  descripcion: null,
  cantidad: 1,
  precioUnitario: 0,
  descuentoPct: 0,
  tratamientoImpuesto: 'vat_21',
  tasaImpuesto: 21,
  ordenLineaId: null,
  ...p,
})

/**
 * Los números esperados son los que devolvió la base con los mismos datos,
 * medidos contra el trigger. Si esta previsualización se despega del
 * servidor, estos tests fallan.
 */
describe('totalesPrevios', () => {
  const A = linea({ id: 'a', cantidad: 10, precioUnitario: 100, tasaImpuesto: 21 })
  const B = linea({
    id: 'b',
    cantidad: 2,
    precioUnitario: 50,
    descuentoPct: 10,
    tratamientoImpuesto: 'not_taxed',
    tasaImpuesto: 0,
  })
  const CAP = linea({ id: 'c', tipoLinea: 'chapter', cantidad: 1, precioUnitario: 0 })

  it('una línea con IVA 21', () => {
    expect(totalesPrevios([A], null, null)).toEqual({
      subtotal: 1000,
      impuesto: 210,
      total: 1210,
    })
  })

  it('un capítulo no suma', () => {
    expect(totalesPrevios([A, CAP], null, null)).toEqual(totalesPrevios([A], null, null))
  })

  it('línea con descuento propio y sin impuesto', () => {
    expect(totalesPrevios([A, B], null, null)).toEqual({
      subtotal: 1090,
      impuesto: 210,
      total: 1300,
    })
  })

  it('descuento global del 10 % — el IVA también baja', () => {
    expect(totalesPrevios([A, B], 10, null)).toEqual({
      subtotal: 981,
      impuesto: 189,
      total: 1170,
    })
  })

  it('descuento global más percepción del 2,5 %', () => {
    expect(totalesPrevios([A, B], 10, 2.5)).toEqual({
      subtotal: 981,
      impuesto: 213.53,
      total: 1194.53,
    })
  })

  it('sin líneas da cero, no NaN', () => {
    expect(totalesPrevios([], 10, 2.5)).toEqual({ subtotal: 0, impuesto: 0, total: 0 })
  })
})

describe('netoDeLinea', () => {
  it('aplica el descuento de la línea', () => {
    expect(netoDeLinea(linea({ cantidad: 2, precioUnitario: 50, descuentoPct: 10 }))).toBe(90)
  })

  it('un capítulo vale cero aunque tenga precio cargado', () => {
    expect(netoDeLinea(linea({ tipoLinea: 'chapter', cantidad: 5, precioUnitario: 99 }))).toBe(0)
  })

  it('una línea sin precio no rompe', () => {
    expect(netoDeLinea(linea({ precioUnitario: null }))).toBe(0)
  })

  it('netoDeLineas suma', () => {
    expect(
      netoDeLineas([
        linea({ id: '1', cantidad: 1, precioUnitario: 10 }),
        linea({ id: '2', cantidad: 2, precioUnitario: 5 }),
      ]),
    ).toBe(20)
  })
})
