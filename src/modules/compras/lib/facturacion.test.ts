import { describe, expect, it } from 'vitest'
import { diferenciasConPedido, repartoDeLineas, totalesDeFactura } from './facturacion'
import type { LineaAFacturar } from '../services/facturas'
import type { LineaFactura } from '../types'

const aFacturar = (cambios: Partial<LineaAFacturar> = {}): LineaAFacturar => ({
  goodsReceiptLineId: null,
  purchaseOrderLineId: null,
  productId: null,
  sku: null,
  descripcion: 'Algo',
  cantidad: 1,
  precioUnitario: 100,
  descuentoPct: 0,
  tratamientoImpuesto: 'vat_21',
  tasaImpuesto: 21,
  ...cambios,
})

const linea = (cambios: Partial<LineaFactura> = {}): LineaFactura => ({
  id: 'l1',
  numeroLinea: 1,
  goodsReceiptLineId: null,
  purchaseOrderLineId: null,
  productId: null,
  sku: null,
  descripcion: 'Algo',
  cantidad: 1,
  precioUnitario: 100,
  descuentoPct: 0,
  tratamientoImpuesto: 'vat_21',
  tasaImpuesto: 21,
  netoServidor: 100,
  recepcionNumero: null,
  pedidoNumero: null,
  precioPedido: null,
  tratamientoPedido: null,
  ...cambios,
})

describe('totalesDeFactura', () => {
  it('neto por línea y después el IVA de su alícuota', () => {
    const t = totalesDeFactura([aFacturar({ cantidad: 2, precioUnitario: 100 })])
    expect(t.bruto).toBe(200)
    expect(t.descuento).toBe(0)
    expect(t.subtotal).toBe(200)
    expect(t.impuesto).toBe(42)
    expect(t.total).toBe(242)
  })

  it('el descuento de línea baja la base imponible, no sólo el subtotal', () => {
    const t = totalesDeFactura([
      aFacturar({ cantidad: 1, precioUnitario: 1000, descuentoPct: 10 }),
    ])
    expect(t.bruto).toBe(1000)
    expect(t.descuento).toBe(100)
    expect(t.subtotal).toBe(900)
    // 21 % de 900, no de 1000.
    expect(t.impuesto).toBe(189)
    expect(t.total).toBe(1089)
  })

  it('cada línea lleva su propia alícuota: no hay un 21 % de la factura entera', () => {
    const t = totalesDeFactura([
      aFacturar({ cantidad: 1, precioUnitario: 100, tratamientoImpuesto: 'vat_21', tasaImpuesto: 21 }),
      aFacturar({ cantidad: 1, precioUnitario: 100, tratamientoImpuesto: 'vat_105', tasaImpuesto: 10.5 }),
      aFacturar({ cantidad: 1, precioUnitario: 100, tratamientoImpuesto: 'exempt', tasaImpuesto: 0 }),
    ])
    expect(t.subtotal).toBe(300)
    expect(t.impuesto).toBe(31.5)
    expect(t.total).toBe(331.5)
  })

  it('un tratamiento sin impuesto no inventa ninguno', () => {
    const t = totalesDeFactura([aFacturar({ tratamientoImpuesto: 'not_taxed', tasaImpuesto: null })])
    expect(t.impuesto).toBe(0)
    expect(t.total).toBe(100)
  })


  it('la alícuota sale del tratamiento aunque la línea no la traiga', () => {
    // Como nacen las líneas al elegir «facturar todo lo pendiente». Antes esto
    // daba «Impuesto 0,00» en una factura con IVA: el bug estaba acá.
    const t = totalesDeFactura([
      aFacturar({ cantidad: 25, precioUnitario: 128.5, tratamientoImpuesto: 'vat_21', tasaImpuesto: null }),
      aFacturar({ cantidad: 12, precioUnitario: 2340.75, tratamientoImpuesto: 'vat_21', tasaImpuesto: null }),
      aFacturar({ cantidad: 1, precioUnitario: 1850, tratamientoImpuesto: 'exempt', tasaImpuesto: null }),
    ])
    expect(t.subtotal).toBe(33151.5)
    expect(t.impuesto).toBe(6573.32)
    expect(t.total).toBe(39724.82)
  })

  it('en «otra alícuota» manda la que se escribió, que es el único caso', () => {
    const conTasa = totalesDeFactura([aFacturar({ precioUnitario: 1000, tratamientoImpuesto: 'other', tasaImpuesto: 3 })])
    expect(conTasa.impuesto).toBe(30)
    const sinTasa = totalesDeFactura([aFacturar({ precioUnitario: 1000, tratamientoImpuesto: 'other', tasaImpuesto: null })])
    expect(sinTasa.impuesto).toBe(0)
  })

  it('una alícuota mandada a mano NO pisa la del tratamiento', () => {
    // El bug del 1 % del legacy, del lado de la previsualización.
    const t = totalesDeFactura([aFacturar({ precioUnitario: 1000, tratamientoImpuesto: 'vat_21', tasaImpuesto: 1 })])
    expect(t.impuesto).toBe(210)
  })
  it('sin líneas, todo en cero', () => {
    const t = totalesDeFactura([])
    expect(t).toEqual({ bruto: 0, descuento: 0, subtotal: 0, impuesto: 0, total: 0 })
  })
})

describe('repartoDeLineas', () => {
  it('separa lo que vino de mercadería de lo que no', () => {
    const r = repartoDeLineas([
      linea({ id: 'a', goodsReceiptLineId: 'rl1', netoServidor: 1000 }),
      linea({ id: 'b', goodsReceiptLineId: 'rl2', netoServidor: 500 }),
      linea({ id: 'c', descripcion: 'Flete', netoServidor: 120.5 }),
    ])
    expect(r.conRecepcion).toBe(2)
    expect(r.sinRecepcion).toBe(1)
    expect(r.netoConRecepcion).toBe(1500)
    expect(r.netoSinRecepcion).toBe(120.5)
  })

  it('una factura de puros gastos no tiene nada de mercadería', () => {
    const r = repartoDeLineas([linea({ descripcion: 'Seguro', netoServidor: 80 })])
    expect(r.conRecepcion).toBe(0)
    expect(r.netoConRecepcion).toBe(0)
    expect(r.sinRecepcion).toBe(1)
  })
})

describe('diferenciasConPedido', () => {
  it('avisa cuando el proveedor factura a otro precio', () => {
    const d = diferenciasConPedido([
      linea({ purchaseOrderLineId: 'pol1', precioPedido: 100, precioUnitario: 115 }),
    ])
    expect(d).toHaveLength(1)
    expect(d[0]?.tipo).toBe('precio')
    expect(d[0]?.enPedido).toBe('100')
    expect(d[0]?.enFactura).toBe('115')
  })

  it('avisa cuando cambia el tratamiento de impuesto', () => {
    const d = diferenciasConPedido([
      linea({
        purchaseOrderLineId: 'pol1',
        precioPedido: 100,
        precioUnitario: 100,
        tratamientoPedido: 'vat_21',
        tratamientoImpuesto: 'vat_105',
      }),
    ])
    expect(d).toHaveLength(1)
    expect(d[0]?.tipo).toBe('impuesto')
  })

  it('una línea libre no se compara con nada', () => {
    // No sale de ningún pedido: no hay contra qué medirla.
    expect(diferenciasConPedido([linea({ descripcion: 'Flete', precioUnitario: 999 })])).toEqual([])
  })

  it('un centésimo de diferencia por redondeo no es una discrepancia', () => {
    const d = diferenciasConPedido([
      linea({ purchaseOrderLineId: 'pol1', precioPedido: 100, precioUnitario: 100.00001 }),
    ])
    expect(d).toEqual([])
  })

  it('precio e impuesto distintos son dos avisos, no uno', () => {
    const d = diferenciasConPedido([
      linea({
        purchaseOrderLineId: 'pol1',
        precioPedido: 100,
        precioUnitario: 110,
        tratamientoPedido: 'vat_21',
        tratamientoImpuesto: 'exempt',
      }),
    ])
    expect(d.map((x) => x.tipo)).toEqual(['precio', 'impuesto'])
  })
})
