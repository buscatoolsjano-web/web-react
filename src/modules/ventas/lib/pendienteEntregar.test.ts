import { describe, expect, it } from 'vitest'
import { accionesDeEntrega, clientesDe, diasEsperando, estadoDeEntrega, tramosDeEntrega } from './pendienteEntregar'
import type { ProductoPendienteEntrega } from '../services/pendienteEntregar'

const p = (over: Partial<Parameters<typeof estadoDeEntrega>[0]> = {}) => ({
  productoId: 'p', sku: 'X', nombre: 'X', pedido: 10, entregado: 2, pendiente: 8,
  stock: 0, enCamino: 0, faltaPedir: 8, documentos: [], ...over,
})

describe('pendiente de entregar (Fase 238)', () => {
  it('lo pendiente se cubre primero con stock, después con lo que viene en camino', () => {
    expect(tramosDeEntrega(p({ stock: 3, enCamino: 4 }))).toEqual({ entregado: 2, conStock: 3, enCamino: 4, falta: 1 })
    expect(tramosDeEntrega(p({ stock: 50, enCamino: 4 }))).toEqual({ entregado: 2, conStock: 8, enCamino: 0, falta: 0 })
  })

  it('el estado es lo más urgente: falta pedir, en camino o con stock', () => {
    expect(estadoDeEntrega(p()).texto).toBe('Falta pedir')
    expect(estadoDeEntrega(p({ enCamino: 8 })).filtro).toBe('camino')
    expect(estadoDeEntrega(p({ stock: 8 })).filtro).toBe('stock')
  })
})

describe('lo que hay que hacer con cada producto (rediseño)', () => {
  const doc = (fecha: string, cliente: string | null, pendiente: number) => ({
    pedidoId: fecha + cliente,
    numero: 'PDV1',
    fecha,
    cliente,
    borrador: false,
    pedido: pendiente,
    entregado: 0,
    pendiente,
    enCamino: 0,
  })
  const prod = (d: Partial<ProductoPendienteEntrega>): ProductoPendienteEntrega => ({
    productoId: 'p',
    sku: 'X',
    nombre: 'X',
    pedido: 100,
    entregado: 0,
    pendiente: 100,
    stock: 0,
    enCamino: 0,
    faltaPedir: 0,
    documentos: [],
    ...d,
  })

  it('acciones en palabras, de lo más urgente a lo menos, sin repetir números', () => {
    expect(accionesDeEntrega(prod({ stock: 30, enCamino: 20 }))).toEqual([
      { tono: 'tFalta', texto: 'Pedí 50' },
      { tono: 'tCamino', texto: 'Llegan 20' },
      { tono: 'tStock', texto: 'Entregá 30 ya' },
    ])
    expect(accionesDeEntrega(prod({ stock: 500 }))).toEqual([{ tono: 'tStock', texto: 'Entregá 100 ya' }])
  })

  it('días esperando: el pedido pendiente más viejo', () => {
    const p = prod({ documentos: [doc('2026-11-20', 'A', 5), doc('2026-10-26', 'B', 3), doc('2026-09-01', 'C', 0)] })
    expect(diasEsperando(p, new Date(2026, 10, 25))).toBe(30)
    expect(diasEsperando(prod({}), new Date(2026, 10, 25))).toBeNull()
  })

  it('clientes: los primeros y cuántos más', () => {
    const p = prod({ documentos: [doc('2026-11-01', 'Whirlpool', 1), doc('2026-11-02', 'Mirgor', 1), doc('2026-11-03', 'Simpa', 1), doc('2026-11-04', 'Whirlpool', 2), doc('2026-11-05', null, 1)] })
    expect(clientesDe(p)).toBe('Whirlpool, Mirgor y 2 más')
  })
})
