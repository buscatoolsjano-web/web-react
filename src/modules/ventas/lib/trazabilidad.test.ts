import { describe, expect, it } from 'vitest'
import { presentarEvento, type EventoAuditoria } from './trazabilidad'

const evento = (p: Partial<EventoAuditoria> = {}): EventoAuditoria => ({
  id: 1,
  accion: 'updated_sensitive_fields',
  desde: null,
  hasta: null,
  diff: null,
  actor: 'Lisandro',
  fecha: '2026-09-16T14:32:10.000Z',
  ...p,
})

describe('presentarEvento', () => {
  it('traduce la acción y firma con quién y cuándo', () => {
    const e = presentarEvento(evento({ accion: 'sent', desde: 'draft', hasta: 'sent' }), 'cotizacion')
    expect(e.titulo).toBe('Marcado como enviado')
    expect(e.quien).toBe('Lisandro')
    expect(e.cuando).toMatch(/16\/09\/2026/)
  })

  it('el cambio de estado se cuenta con las etiquetas del documento, no con el código', () => {
    const e = presentarEvento(evento({ accion: 'approved', desde: 'sent', hasta: 'accepted' }), 'cotizacion')
    expect(e.detalle).toEqual(['Estado: Pendiente → Cerrada'])
  })

  it('el diff se lee como una frase, con el nombre que usa la gente', () => {
    const e = presentarEvento(
      evento({ diff: { unit_price: { from: 100, to: 90 }, discount_pct: { from: null, to: 10 } } }),
      'cotizacion',
    )
    expect(e.detalle).toEqual(['Precio unitario: 100 → 90', 'Descuento: sin valor → 10'])
  })

  it('un valor que no es un número ni un texto no se vuelca crudo a la pantalla', () => {
    const e = presentarEvento(evento({ diff: { unit_price: { from: { a: 1 }, to: [1, 2] } } }), 'cotizacion')
    expect(e.detalle).toEqual(['Precio unitario: sin detalle → sin detalle'])
  })

  it('sin actor el evento lo escribió un proceso, y se dice así', () => {
    expect(presentarEvento(evento({ actor: null }), 'cotizacion').quien).toBe('Proceso del sistema')
  })

  it('una acción todavía sin traducción se muestra legible, no en crudo', () => {
    expect(presentarEvento(evento({ accion: 'stock_reserved' }), 'pedido').titulo).toBe('Stock reserved')
  })
})
