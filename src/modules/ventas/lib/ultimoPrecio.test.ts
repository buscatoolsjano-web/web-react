import { describe, expect, it } from 'vitest'
import type { UltimoPrecio } from '@/modules/clientes/types'
import {
  avisoDePrecio,
  mismoPrecio,
  porProductoEnMoneda,
  precioParaLineaNueva,
} from './ultimoPrecio'

/** El caso real: mismo cliente y producto, 49,40 y después 22,20 en USD. */
const PDV: UltimoPrecio = {
  productId: '044c69d3-b78c-4a07-a300-bfb8c95b7a0e',
  sku: 'PRO05229',
  nombre: 'Balanceador',
  moneda: 'USD',
  ultimoPrecio: 22.2,
  ultimaFecha: '2026-05-19',
  ultimoDocumento: 'PDV01233',
  ultimoDocumentoId: 'd1',
  ultimoTipo: 'pedido',
  precioAnterior: 49.4,
  veces: 2,
}

describe('precioParaLineaNueva', () => {
  it('el histórico del cliente le gana a la tarifa', () => {
    expect(precioParaLineaNueva(PDV, 49.4)).toEqual({ precio: 22.2, deHistorico: true })
  })

  it('sin histórico manda la tarifa, como siempre', () => {
    expect(precioParaLineaNueva(undefined, 49.4)).toEqual({ precio: 49.4, deHistorico: false })
  })

  it('sin histórico y sin tarifa, cero y a mano', () => {
    // Es la regla que ya estaba: antes que convertir o adivinar, entra en cero
    // y se ve. Hay 9.470 productos activos sin precio en ninguna lista.
    expect(precioParaLineaNueva(undefined, null)).toEqual({ precio: 0, deHistorico: false })
  })

  it('un histórico sin precio no cuenta como histórico', () => {
    expect(precioParaLineaNueva({ ...PDV, ultimoPrecio: null }, 49.4)).toEqual({
      precio: 49.4,
      deHistorico: false,
    })
  })
})

describe('mismoPrecio', () => {
  it('22.2 tipeado y 22.2000 de la base son el mismo precio', () => {
    expect(mismoPrecio(22.2, 22.2)).toBe(true)
    // Lo que de verdad pasa con punto flotante.
    expect(mismoPrecio(0.1 + 0.2, 0.3)).toBe(true)
  })

  it('un centavo de diferencia ya es otro precio', () => {
    expect(mismoPrecio(22.2, 22.21)).toBe(false)
  })
})

describe('avisoDePrecio', () => {
  it('sin histórico no inventa nada', () => {
    expect(avisoDePrecio(undefined, 49.4)).toBeNull()
    expect(avisoDePrecio({ ...PDV, ultimoPrecio: null }, 49.4)).toBeNull()
  })

  it('cuando el precio es el del último documento, lo dice en gris', () => {
    const a = avisoDePrecio(PDV, 22.2)
    expect(a?.tono).toBe('igual')
    expect(a?.texto).toMatch(/último precio/i)
  })

  it('cuando se cambió, avisa en naranja con monto, documento y fecha', () => {
    const a = avisoDePrecio(PDV, 49.4)
    expect(a?.tono).toBe('historico')
    expect(a?.texto).toContain('PDV01233')
    expect(a?.texto).toContain('pedido')
    // El monto del histórico, no el que está escrito en la línea.
    expect(a?.texto).toMatch(/22[.,]20/)
    expect(a?.texto).not.toMatch(/49[.,]40/)
  })

  it('una cotización se nombra como cotización, no como pedido', () => {
    const a = avisoDePrecio(
      { ...PDV, ultimoTipo: 'cotizacion', ultimoDocumento: 'COTI02555' },
      49.4,
    )
    expect(a?.texto).toContain('cotización COTI02555')
  })

  it('sin fecha ni número no escribe «undefined» ni deja basura', () => {
    const a = avisoDePrecio({ ...PDV, ultimaFecha: null, ultimoDocumento: null }, 49.4)
    expect(a?.texto).not.toMatch(/undefined|null/)
    expect(a?.texto).toMatch(/Último precio: .+ · pedido/)
  })
})

describe('porProductoEnMoneda', () => {
  const enPesos: UltimoPrecio = { ...PDV, moneda: 'ARS', ultimoPrecio: 31000, ultimoDocumento: 'PDV01300' }

  it('elige la fila de la moneda del documento', () => {
    const m = porProductoEnMoneda([PDV, enPesos], 'USD')
    expect(m.get(PDV.productId!)?.ultimoPrecio).toBe(22.2)
    expect(porProductoEnMoneda([PDV, enPesos], 'ARS').get(PDV.productId!)?.ultimoPrecio).toBe(31000)
  })

  it('en una moneda sin histórico no devuelve nada, y NO convierte', () => {
    // El precio de otra moneda no se trae ni se convierte: así el legacy dejó
    // 104 documentos sin tipo de cambio.
    expect(porProductoEnMoneda([PDV], 'EUR').size).toBe(0)
  })

  it('no le importan las mayúsculas ni los espacios', () => {
    expect(porProductoEnMoneda([PDV], ' usd ').size).toBe(1)
  })

  it('sin moneda del documento no hay nada que comparar', () => {
    expect(porProductoEnMoneda([PDV], null).size).toBe(0)
    expect(porProductoEnMoneda([PDV], '').size).toBe(0)
  })

  it('las filas sin producto se descartan', () => {
    // `precios_historicos_cliente` también devuelve líneas sueltas, que tienen
    // sku pero no `product_id`: no se pueden emparejar con una línea nueva.
    expect(porProductoEnMoneda([{ ...PDV, productId: null }], 'USD').size).toBe(0)
  })
})
