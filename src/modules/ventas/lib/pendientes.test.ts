import { describe, expect, it } from 'vitest'
import { calcularPendientes } from './pendientes'

const linea = (id: string, cantidadPedida: number) => ({ id, cantidadPedida })
const entrega = (ordenLineaId: string | null, cantidad: number) => ({ ordenLineaId, cantidad })

describe('calcularPendientes', () => {
  it('reconstruye por línea cuando todas las líneas de entrega están enlazadas', () => {
    const r = calcularPendientes({
      lineasPedido: [linea('a', 100), linea('b', 10)],
      lineasEntrega: [entrega('a', 30), entrega('a', 40), entrega('b', 10)],
      hayEntregasEnlazadas: true,
      hayRemitosHuerfanosDelCliente: false,
    })

    expect(r.estado).toBe('RECONSTRUIDO')
    expect(r.porLinea).toEqual([
      { lineaId: 'a', pedido: 100, entregado: 70, pendiente: 30, exceso: 0 },
      { lineaId: 'b', pedido: 10, entregado: 10, pendiente: 0, exceso: 0 },
    ])
    expect(r.hayExceso).toBe(false)
  })

  it('marca NO_CONSTA_ENTREGA y NO devuelve ningún número cuando el cliente tiene un remito huérfano', () => {
    const r = calcularPendientes({
      lineasPedido: [linea('a', 100)],
      lineasEntrega: [],
      hayEntregasEnlazadas: false,
      hayRemitosHuerfanosDelCliente: true,
    })

    expect(r.estado).toBe('NO_CONSTA_ENTREGA')
    // Lo importante del caso: no dice "pendiente = 100".
    expect(r.porLinea).toEqual([])
  })

  it('sin entregas y sin remitos huérfanos sí puede afirmar entregado = 0', () => {
    const r = calcularPendientes({
      lineasPedido: [linea('a', 100)],
      lineasEntrega: [],
      hayEntregasEnlazadas: false,
      hayRemitosHuerfanosDelCliente: false,
    })

    expect(r.estado).toBe('RECONSTRUIDO')
    expect(r.porLinea).toEqual([
      { lineaId: 'a', pedido: 100, entregado: 0, pendiente: 100, exceso: 0 },
    ])
  })

  it('marca DETALLE_NO_RECONSTRUIDO si UNA sola línea de entrega quedó sin enlazar', () => {
    const r = calcularPendientes({
      lineasPedido: [linea('a', 100), linea('b', 10)],
      // La primera está enlazada; la segunda no, y esa cantidad podría ser de
      // cualquiera de las dos líneas.
      lineasEntrega: [entrega('a', 30), entrega(null, 5)],
      hayEntregasEnlazadas: true,
      hayRemitosHuerfanosDelCliente: false,
    })

    expect(r.estado).toBe('DETALLE_NO_RECONSTRUIDO')
    expect(r.porLinea).toEqual([])
    expect(r.lineasSinEnlazar).toBe(1)
  })

  it('informa el exceso sin dejar el pendiente en negativo — PDV01181: pidió 1, entregó 2', () => {
    const r = calcularPendientes({
      lineasPedido: [linea('a', 1)],
      lineasEntrega: [entrega('a', 2)],
      hayEntregasEnlazadas: true,
      hayRemitosHuerfanosDelCliente: false,
    })

    expect(r.estado).toBe('RECONSTRUIDO')
    expect(r.porLinea[0]).toEqual({
      lineaId: 'a',
      pedido: 1,
      entregado: 2,
      pendiente: 0,
      exceso: 1,
    })
    expect(r.hayExceso).toBe(true)
  })

  it('PDV01238: 4 pedidas, 7 entregadas en dos remitos', () => {
    const r = calcularPendientes({
      lineasPedido: [linea('a', 4)],
      lineasEntrega: [entrega('a', 4), entrega('a', 3)],
      hayEntregasEnlazadas: true,
      hayRemitosHuerfanosDelCliente: false,
    })

    expect(r.porLinea[0]?.entregado).toBe(7)
    expect(r.porLinea[0]?.exceso).toBe(3)
  })

  it('una línea del pedido sin ninguna entrega queda pendiente entera', () => {
    const r = calcularPendientes({
      lineasPedido: [linea('a', 5), linea('b', 8)],
      lineasEntrega: [entrega('a', 5)],
      hayEntregasEnlazadas: true,
      hayRemitosHuerfanosDelCliente: false,
    })

    expect(r.porLinea[1]).toEqual({
      lineaId: 'b',
      pedido: 8,
      entregado: 0,
      pendiente: 8,
      exceso: 0,
    })
  })

  it('NUNCA devuelve cantidades en los dos estados sin evidencia', () => {
    const sinEvidencia = [
      calcularPendientes({
        lineasPedido: [linea('a', 100)],
        lineasEntrega: [],
        hayEntregasEnlazadas: false,
        hayRemitosHuerfanosDelCliente: true,
      }),
      calcularPendientes({
        lineasPedido: [linea('a', 100)],
        lineasEntrega: [entrega(null, 1)],
        hayEntregasEnlazadas: true,
        hayRemitosHuerfanosDelCliente: false,
      }),
    ]

    for (const r of sinEvidencia) {
      expect(r.estado).not.toBe('RECONSTRUIDO')
      expect(r.porLinea).toHaveLength(0)
    }
  })

  it('un pedido sin líneas no rompe', () => {
    const r = calcularPendientes({
      lineasPedido: [],
      lineasEntrega: [],
      hayEntregasEnlazadas: false,
      hayRemitosHuerfanosDelCliente: false,
    })

    expect(r.estado).toBe('RECONSTRUIDO')
    expect(r.porLinea).toEqual([])
  })
})
