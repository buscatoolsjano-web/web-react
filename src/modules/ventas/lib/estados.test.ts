import { describe, expect, it } from 'vitest'
import {
  estadosDisponibles,
  presentarCumplimiento,
  presentarEstado,
  presentarMotivo,
  separarMotivos,
} from './estados'

describe('presentarEstado', () => {
  it('traduce los estados que dejó la migración', () => {
    expect(presentarEstado('cotizacion', 'sent').etiqueta).toBe('Pendiente')
    expect(presentarEstado('cotizacion', 'accepted').etiqueta).toBe('Cerrada')
    expect(presentarEstado('pedido', 'confirmed').etiqueta).toBe('Confirmado')
    expect(presentarEstado('entrega', 'delivered').etiqueta).toBe('Entregada')
  })

  it('un estado desconocido se muestra crudo en vez de desaparecer', () => {
    expect(presentarEstado('cotizacion', 'inventado')).toEqual({
      etiqueta: 'inventado',
      tono: 'neutro',
    })
  })

  it('null se muestra como raya', () => {
    expect(presentarEstado('pedido', null).etiqueta).toBe('—')
  })

  it('el cumplimiento del pedido es un estado aparte del comercial', () => {
    expect(presentarCumplimiento('delivered').etiqueta).toBe('Entregado')
    expect(presentarCumplimiento('pending').etiqueta).toBe('Sin entregar')
  })

  it('las opciones del filtro salen de la misma tabla', () => {
    const valores = estadosDisponibles('cotizacion').map((e) => e.valor)
    expect(valores).toContain('sent')
    expect(valores).toContain('accepted')
    expect(estadosDisponibles('entrega').map((e) => e.valor)).toContain('delivered')
  })
})

describe('separarMotivos', () => {
  it('separa los motivos concatenados y descarta el detalle después de los dos puntos', () => {
    expect(separarMotivos('NO_EXCHANGE_RATE | TOTALS_DO_NOT_CLOSE | NO_ORDER_LINK')).toEqual([
      'NO_EXCHANGE_RATE',
      'TOTALS_DO_NOT_CLOSE',
      'NO_ORDER_LINK',
    ])
    expect(separarMotivos('UNRESOLVED_SKU: PRO12345')).toEqual(['UNRESOLVED_SKU'])
  })

  it('null y vacío dan lista vacía', () => {
    expect(separarMotivos(null)).toEqual([])
    expect(separarMotivos('')).toEqual([])
  })

  it('traduce los motivos conocidos y deja pasar los que no', () => {
    expect(presentarMotivo('NUMBER_OUTLIER')).toBe('Número fuera de serie')
    expect(presentarMotivo('OVERDELIVERED')).toBe('Se entregó más de lo pedido')
    expect(presentarMotivo('ALGO_NUEVO')).toBe('ALGO_NUEVO')
  })
})
