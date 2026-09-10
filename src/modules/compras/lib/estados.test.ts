import { describe, expect, it } from 'vitest'
import {
  editabilidadDe,
  editabilidadDeFactura,
  etiquetaDeEstadoPedido,
  etiquetaDeRecepcion,
} from './estados'

describe('etiquetas', () => {
  it('traduce los tres estados comerciales', () => {
    expect(etiquetaDeEstadoPedido('draft')).toBe('Borrador')
    expect(etiquetaDeEstadoPedido('confirmed')).toBe('Confirmado')
    expect(etiquetaDeEstadoPedido('cancelled')).toBe('Cancelado')
  })

  it('y los tres logísticos, que son otra cosa', () => {
    expect(etiquetaDeRecepcion('pending')).toBe('Sin recibir')
    expect(etiquetaDeRecepcion('partially_received')).toBe('Recibido en parte')
    expect(etiquetaDeRecepcion('received')).toBe('Recibido')
  })

  it('un estado desconocido se muestra crudo en vez de desaparecer', () => {
    expect(etiquetaDeEstadoPedido('lo_que_sea')).toBe('lo_que_sea')
    expect(etiquetaDeRecepcion('lo_que_sea')).toBe('lo_que_sea')
  })
})

describe('editabilidadDe', () => {
  it('en borrador se toca todo', () => {
    const e = editabilidadDe('draft', false)
    expect(e).toEqual({
      cabecera: true,
      identidad: true,
      logistica: true,
      lineas: true,
      confirmar: true,
      cancelar: true,
      duplicar: true,
    })
  })

  it('confirmado sin recepción: la identidad se congela, la logística no', () => {
    const e = editabilidadDe('confirmed', false)
    expect(e.identidad).toBe(false)
    expect(e.logistica).toBe(true)
    expect(e.lineas).toBe(true)
    expect(e.confirmar).toBe(false)
    expect(e.cancelar).toBe(true)
  })

  it('confirmado CON recepción: las líneas se congelan y no se cancela', () => {
    const e = editabilidadDe('confirmed', true)
    expect(e.lineas).toBe(false)
    expect(e.cancelar).toBe(false)
    // La llegada estimada y las notas se siguen pudiendo ajustar.
    expect(e.logistica).toBe(true)
  })

  it('cancelado está congelado entero', () => {
    const e = editabilidadDe('cancelled', false)
    expect(e.cabecera).toBe(false)
    expect(e.identidad).toBe(false)
    expect(e.logistica).toBe(false)
    expect(e.lineas).toBe(false)
    expect(e.confirmar).toBe(false)
    expect(e.cancelar).toBe(false)
  })

  it('duplicar se puede siempre: el duplicado es un pedido nuevo', () => {
    for (const estado of ['draft', 'confirmed', 'cancelled'] as const) {
      expect(editabilidadDe(estado, false).duplicar).toBe(true)
      expect(editabilidadDe(estado, true).duplicar).toBe(true)
    }
  })

  it('un borrador con recepción confirmada tampoco edita líneas', () => {
    // No debería pasar —una recepción sale de un pedido confirmado— pero si
    // pasa, manda la mercadería recibida.
    expect(editabilidadDe('draft', true).lineas).toBe(false)
  })
})

describe('editabilidadDeFactura', () => {
  it('un borrador se edita, se registra, se anula y se descarta', () => {
    const e = editabilidadDeFactura('draft')
    expect(e.cabecera).toBe(true)
    expect(e.lineas).toBe(true)
    expect(e.registrar).toBe(true)
    expect(e.anular).toBe(true)
    expect(e.borrar).toBe(true)
  })

  it('una registrada está congelada: sólo se anula', () => {
    const e = editabilidadDeFactura('registered')
    expect(e.cabecera).toBe(false)
    expect(e.lineas).toBe(false)
    expect(e.registrar).toBe(false)
    expect(e.anular).toBe(true)
    // Es un documento con historia: se anula, no se borra.
    expect(e.borrar).toBe(false)
  })

  it('una anulada no vuelve de ningún lado', () => {
    const e = editabilidadDeFactura('cancelled')
    expect(e.cabecera).toBe(false)
    expect(e.lineas).toBe(false)
    expect(e.registrar).toBe(false)
    expect(e.anular).toBe(false)
    expect(e.borrar).toBe(false)
  })
})
