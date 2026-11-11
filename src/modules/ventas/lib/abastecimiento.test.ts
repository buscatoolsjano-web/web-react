import { describe, expect, it } from 'vitest'
import { estadoDeLinea, pendienteDeCompra, repartoDeCompra, sugeridoComprar } from './abastecimiento'
import type { LineaAbastecimiento } from '../services/abastecimiento'

const linea = (over: Partial<LineaAbastecimiento> = {}): LineaAbastecimiento => ({
  lineaId: 'l1', lineaNo: 1, productoId: 'p1', sku: 'TE.9370', nombre: 'Balanceador',
  vendido: 10, pedidoParaVenta: 0, stockDisponible: 0, compras: [], ...over,
})

describe('abastecimiento de una venta (Fase 237)', () => {
  it('pendiente: lo vendido que todavía no tiene compra asignada', () => {
    expect(pendienteDeCompra(linea({ vendido: 10, pedidoParaVenta: 4 }))).toBe(6)
    expect(pendienteDeCompra(linea({ vendido: 10, pedidoParaVenta: 12 }))).toBe(0)
  })

  it('sugerido: el pendiente menos el stock disponible', () => {
    expect(sugeridoComprar(linea({ vendido: 10, pedidoParaVenta: 4, stockDisponible: 2 }))).toBe(4)
    expect(sugeridoComprar(linea({ vendido: 10, stockDisponible: 50 }))).toBe(0)
  })

  it('lo que se compra de más va a stock, y se dice cuánto', () => {
    expect(repartoDeCompra(15, linea({ vendido: 10 }))).toEqual({ paraVenta: 10, paraStock: 5 })
    expect(repartoDeCompra(3, linea({ vendido: 10 }))).toEqual({ paraVenta: 3, paraStock: 0 })
    // Si la venta ya está cubierta, todo lo que se compra es para stock.
    expect(repartoDeCompra(5, linea({ vendido: 10, pedidoParaVenta: 10 }))).toEqual({ paraVenta: 0, paraStock: 5 })
  })

  it('el estado de la línea dice lo que importa: falta, hay stock, en camino o recibido', () => {
    expect(estadoDeLinea(linea({ vendido: 10 })).texto).toBe('Faltan 10')
    expect(estadoDeLinea(linea({ vendido: 10, stockDisponible: 20 })).tono).toBe('stock')
    const compra = { pedidoId: 'po', numero: 'PAP1', estado: 'confirmed', estadoRecepcion: 'pending', llegadaEstimada: '2026-12-01', cantidad: 10, paraVenta: 10, recibido: 0 }
    expect(estadoDeLinea(linea({ vendido: 10, pedidoParaVenta: 10, compras: [compra] })).texto).toBe('En camino · llega 01/12/2026')
    expect(estadoDeLinea(linea({ vendido: 10, pedidoParaVenta: 10, compras: [{ ...compra, recibido: 10, estadoRecepcion: 'received' }] })).tono).toBe('ok')
  })
})
