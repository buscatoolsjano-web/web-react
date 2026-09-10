import { describe, expect, it } from 'vitest'
import {
  columnasDe,
  imprimibleFactura,
  imprimiblePedido,
  imprimibleRecepcion,
} from './impresion'
import type {
  FacturaDetalle,
  LineaFactura,
  LineaPedidoCompra,
  LineaRecepcion,
  PedidoCompraDetalle,
  RecepcionDetalle,
} from '../types'

const etiqueta = (t: string) => (t === 'vat_21' ? 'IVA 21 %' : t)

const pedido = (cambios: Partial<PedidoCompraDetalle> = {}): PedidoCompraDetalle => ({
  id: 'p1',
  numero: 'PC00007',
  serie: 'PC',
  estado: 'confirmed',
  estadoRecepcion: 'pending',
  proveedorId: 's1',
  proveedor: 'Herramientas del Sur S.A.',
  proveedorReferencia: 'PROV00042',
  moneda: 'USD',
  tipoCambio: null,
  fecha: '2026-09-10',
  fechaEstimada: null,
  formaPago: null,
  notas: null,
  subtotal: 1000,
  impuesto: 210,
  total: 1210,
  autor: 'Jano',
  creadoEn: '2026-09-10T10:00:00Z',
  actualizadoEn: '2026-09-10T10:00:00Z',
  conRecepcion: false,
  ...cambios,
})

const lineaPedido = (cambios: Partial<LineaPedidoCompra> = {}): LineaPedidoCompra => ({
  id: 'l1',
  numeroLinea: 1,
  tipoLinea: 'product',
  productId: null,
  sku: 'PRO001',
  nombre: 'Un producto',
  descripcion: null,
  cantidad: 10,
  precioUnitario: 100,
  descuentoPct: 0,
  tratamientoImpuesto: 'vat_21',
  tasaImpuesto: 21,
  netoServidor: 1000,
  ...cambios,
})

const recepcion = (cambios: Partial<RecepcionDetalle> = {}): RecepcionDetalle => ({
  id: 'r1',
  numero: 'NEP00003',
  serie: 'NEP',
  estado: 'confirmed',
  fecha: '2026-09-10',
  proveedorId: 's1',
  proveedor: 'Herramientas del Sur S.A.',
  pedidoId: 'p1',
  pedidoNumero: 'PC00007',
  depositoId: 'd1',
  deposito: 'Principal',
  documentoProveedor: 'R-0001-000123',
  notas: null,
  autor: 'Jano',
  confirmadaEn: null,
  confirmadaPor: null,
  creadoEn: '2026-09-10T10:00:00Z',
  ...cambios,
})

const factura = (cambios: Partial<FacturaDetalle> = {}): FacturaDetalle => ({
  id: 'f1',
  numero: 'FP00005',
  serie: 'FP',
  numeroProveedor: 'A-0001-00012345',
  estado: 'registered',
  proveedorId: 's1',
  proveedor: 'Herramientas del Sur S.A.',
  moneda: 'USD',
  tipoCambio: null,
  fecha: '2026-09-10',
  vencimiento: null,
  formaPago: null,
  notas: null,
  subtotal: 1000,
  impuesto: 210,
  total: 1210,
  autor: 'Jano',
  creadoEn: '2026-09-10T10:00:00Z',
  actualizadoEn: '2026-09-10T10:00:00Z',
  ...cambios,
})

const lineaFactura = (cambios: Partial<LineaFactura> = {}): LineaFactura => ({
  id: 'lf1',
  numeroLinea: 1,
  goodsReceiptLineId: 'rl1',
  purchaseOrderLineId: 'pl1',
  productId: null,
  sku: 'PRO001',
  descripcion: 'Un producto',
  cantidad: 10,
  precioUnitario: 100,
  descuentoPct: 0,
  tratamientoImpuesto: 'vat_21',
  tasaImpuesto: 21,
  netoServidor: 1000,
  recepcionNumero: 'NEP00003',
  pedidoNumero: 'PC00007',
  precioPedido: 100,
  tratamientoPedido: 'vat_21',
  ...cambios,
})

describe('columnasDe', () => {
  it('la recepción no lleva importes ni impuesto', () => {
    const c = columnasDe('recepcion')
    expect(c.precios).toBe(false)
    expect(c.impuesto).toBe(false)
    expect(c.origen).toBe(false)
  })

  it('el pedido lleva importes pero no columna de origen', () => {
    const c = columnasDe('pedido')
    expect(c.precios).toBe(true)
    expect(c.impuesto).toBe(true)
    expect(c.origen).toBe(false)
  })

  it('la factura lleva origen: de qué recepción vino cada línea', () => {
    expect(columnasDe('factura').origen).toBe(true)
  })
})

describe('imprimiblePedido', () => {
  it('sale con los totales del servidor, sin recalcular nada', () => {
    const d = imprimiblePedido(pedido(), [lineaPedido()], etiqueta)
    expect(d.titulo).toBe('PEDIDO A PROVEEDOR')
    expect(d.numero).toBe('PC00007')
    expect(d.totales).toEqual({ subtotal: 1000, impuesto: 210, total: 1210 })
  })

  it('los datos que faltan NO se imprimen vacíos', () => {
    // Sin ETA, sin condición de pago y sin tipo de cambio: no hay que imprimir
    // «Entrega estimada: —», hay que no imprimir la fila.
    const d = imprimiblePedido(pedido(), [], etiqueta)
    const etiquetas = d.datos.map((x) => x.etiqueta)
    expect(etiquetas).not.toContain('Entrega estimada')
    expect(etiquetas).not.toContain('Condición de pago')
    expect(etiquetas).not.toContain('Tipo de cambio')
    expect(etiquetas).toContain('Proveedor')
    expect(etiquetas).toContain('Moneda')
  })

  it('la ETA sale en formato local cuando existe', () => {
    const d = imprimiblePedido(pedido({ fechaEstimada: '2026-11-30' }), [], etiqueta)
    expect(d.datos.find((x) => x.etiqueta === 'Entrega estimada')?.valor).toBe('30/11/2026')
  })

  it('un capítulo no lleva número de línea', () => {
    const d = imprimiblePedido(
      pedido(),
      [lineaPedido({ tipoLinea: 'chapter', nombre: 'MATERIALES' })],
      etiqueta,
    )
    expect(d.lineas[0]?.esCapitulo).toBe(true)
    expect(d.lineas[0]?.numero).toBeNull()
  })

  it('traduce el tratamiento de impuesto en vez de imprimir el código', () => {
    const d = imprimiblePedido(pedido(), [lineaPedido()], etiqueta)
    expect(d.lineas[0]?.impuesto).toBe('IVA 21 %')
  })
})

describe('imprimibleRecepcion', () => {
  const lineas: LineaRecepcion[] = [
    { id: 'rl1', purchaseOrderLineId: 'pl1', productId: null, sku: 'PRO001', descripcion: 'Algo', cantidad: 7 },
  ]

  it('no lleva totales: no está valorizada', () => {
    const d = imprimibleRecepcion(recepcion(), lineas)
    expect(d.totales).toBeNull()
    expect(d.moneda).toBeNull()
  })

  it('ninguna línea lleva precio ni impuesto', () => {
    const d = imprimibleRecepcion(recepcion(), lineas)
    expect(d.lineas[0]?.precio).toBeNull()
    expect(d.lineas[0]?.neto).toBeNull()
    expect(d.lineas[0]?.impuesto).toBeNull()
  })

  it('sí lleva depósito, pedido y remito del proveedor', () => {
    const d = imprimibleRecepcion(recepcion(), lineas)
    const etiquetas = d.datos.map((x) => x.etiqueta)
    expect(etiquetas).toContain('Depósito')
    expect(etiquetas).toContain('Pedido de compra')
    expect(etiquetas).toContain('Remito del proveedor')
  })

  it('una recepción sin pedido no inventa la fila del pedido', () => {
    const d = imprimibleRecepcion(recepcion({ pedidoId: null, pedidoNumero: null }), lineas)
    expect(d.datos.map((x) => x.etiqueta)).not.toContain('Pedido de compra')
    expect(d.relacionados).toEqual([])
  })

  it('numera las líneas por su orden, que es el que tiene el documento', () => {
    const d = imprimibleRecepcion(recepcion(), [...lineas, { ...lineas[0]!, id: 'rl2' }])
    expect(d.lineas.map((l) => l.numero)).toEqual([1, 2])
  })
})

describe('imprimibleFactura', () => {
  it('el título grande es el número del PROVEEDOR, no la referencia interna', () => {
    const d = imprimibleFactura(factura(), [lineaFactura()], etiqueta)
    expect(d.numero).toBe('A-0001-00012345')
    expect(d.datos.find((x) => x.etiqueta === 'Referencia interna')?.valor).toBe('FP00005')
  })

  it('si todavía no tiene número del proveedor, cae en la referencia interna', () => {
    const d = imprimibleFactura(factura({ numeroProveedor: null }), [], etiqueta)
    expect(d.numero).toBe('FP00005')
    expect(d.datos.map((x) => x.etiqueta)).not.toContain('Número del proveedor')
  })

  it('cada línea dice de qué recepción vino', () => {
    const d = imprimibleFactura(factura(), [lineaFactura()], etiqueta)
    expect(d.lineas[0]?.origen).toBe('NEP00003')
  })

  it('una línea libre no tiene origen y no se le inventa uno', () => {
    const d = imprimibleFactura(
      factura(),
      [lineaFactura({ goodsReceiptLineId: null, recepcionNumero: null, descripcion: 'Flete' })],
      etiqueta,
    )
    expect(d.lineas[0]?.origen).toBeNull()
  })

  it('imprime el precio que facturó el proveedor, no el del pedido', () => {
    const d = imprimibleFactura(
      factura(),
      [lineaFactura({ precioUnitario: 115, precioPedido: 100 })],
      etiqueta,
    )
    expect(d.lineas[0]?.precio).toBe(115)
  })

  it('lleva los relacionados que le pasen, sin ir a buscarlos sola', () => {
    const d = imprimibleFactura(factura(), [], etiqueta, ['NEP00003', 'PC00007'])
    expect(d.relacionados).toEqual(['NEP00003', 'PC00007'])
  })
})
