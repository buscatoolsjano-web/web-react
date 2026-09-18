import { describe, expect, it } from 'vitest'
import { presentarEvento } from './trazabilidad'
import type { EventoDeCliente } from '../types'

/**
 * La trazabilidad, dicha en castellano (Fase 17 · E4).
 *
 * La regla que se prueba en casi todos los casos es una sola: **nunca sale un
 * UUID a pantalla**. Un id no le dice nada a nadie, y el día que la fila que
 * nombra se borre, tampoco se puede resolver.
 */

const UUID = '6f2a1c34-0b74-4f3d-9a11-3d2e5c8b7a91'

const evento = (p: Partial<EventoDeCliente> = {}): EventoDeCliente => ({
  id: 'e1',
  accion: 'updated',
  desde: null,
  hasta: null,
  diff: null,
  cuando: '2026-09-18T12:00:00Z',
  quien: 'Jano',
  ...p,
})

/** Todo lo que se muestra de un evento, junto, para buscar un uuid adentro. */
const texto = (e: EventoDeCliente): string => {
  const v = presentarEvento(e)
  return [v.titulo, ...v.detalles, v.quien].join(' | ')
}

describe('presentarEvento · qué se lee', () => {
  it('el alta del cliente', () => {
    const v = presentarEvento(evento({ accion: 'created' }))
    expect(v.titulo).toBe('Se creó el cliente')
    expect(v.quien).toBe('Jano')
  })

  it('un cambio de campo dice el campo por su nombre de pantalla y los dos valores', () => {
    const v = presentarEvento(
      evento({ diff: { phone: { from: '11 4444', to: '11 5555' } } }),
    )
    expect(v.titulo).toBe('Se editaron los datos del cliente')
    expect(v.detalles).toEqual(['Cambió el teléfono: de 11 4444 a 11 5555'])
  })

  it('un valor vacío se dice «nada», no se muestra en blanco', () => {
    const v = presentarEvento(evento({ diff: { trade_name: { from: null, to: 'ZZ SA' } } }))
    expect(v.detalles).toEqual(['Cambió el nombre comercial: de nada a ZZ SA'])
  })

  it('una lista se enumera', () => {
    const v = presentarEvento(
      evento({ diff: { emails: { from: [], to: ['a@zz.test', 'b@zz.test'] } } }),
    )
    expect(v.detalles).toEqual(['Cambió los emails: de nada a a@zz.test, b@zz.test'])
  })

  it('sin actor, es el sistema y no un vacío', () => {
    expect(presentarEvento(evento({ quien: null })).quien).toBe('Proceso del sistema')
  })

  it('una acción que no conocemos no rompe la pantalla', () => {
    const v = presentarEvento(evento({ accion: 'algo_nuevo' }))
    expect(v.titulo).toBe('Cambio registrado')
  })
})

describe('presentarEvento · nunca un UUID', () => {
  it('el vendedor y la tarifa se dicen, no se cantan', () => {
    const v = presentarEvento(
      evento({
        diff: {
          salesperson_id: { from: null, to: UUID },
          default_price_list_id: { from: UUID, to: null },
        },
      }),
    )
    expect(v.detalles).toContain('Se asignó el vendedor')
    expect(v.detalles).toContain('Se quitó la tarifa')
    expect(texto(evento({ diff: { salesperson_id: { from: null, to: UUID } } }))).not.toContain(UUID)
  })

  it('cambiar de un vendedor a otro dice que cambió, sin los dos ids', () => {
    const v = presentarEvento(
      evento({ diff: { salesperson_id: { from: UUID, to: 'otro-uuid' } } }),
    )
    expect(v.detalles).toEqual(['Cambió el vendedor'])
  })

  it('el contacto se nombra por su nombre, aunque el diff traiga el id', () => {
    const v = presentarEvento(
      evento({
        accion: 'contact_updated',
        diff: {
          contacto: 'Ana Pérez',
          contacto_id: UUID,
          phone: { from: null, to: '11 5555' },
        },
      }),
    )
    expect(v.titulo).toBe('Se editó un contacto: Ana Pérez')
    expect(v.detalles).toEqual(['Cambió el teléfono: de nada a 11 5555'])
    expect(texto(evento({ accion: 'contact_updated', diff: { contacto: 'Ana Pérez', contacto_id: UUID } }))).not.toContain(UUID)
  })

  it('la dirección se nombra por su calle y su tipo', () => {
    const e = evento({
      accion: 'address_updated',
      diff: { direccion: 'Av. Siempreviva 742', tipo: 'shipping', direccion_id: UUID },
    })
    expect(presentarEvento(e).titulo).toBe('Se editó una dirección: Av. Siempreviva 742 (entrega)')
    expect(texto(e)).not.toContain(UUID)
  })

  it('un objeto suelto en el diff no se imprime como [object Object]', () => {
    const v = presentarEvento(evento({ diff: { notes: { from: null, to: { raro: 1 } } } }))
    expect(v.detalles).toEqual(['Cambió las notas: de nada a otro valor'])
  })
})

describe('presentarEvento · la agenda y los adjuntos', () => {
  it('un contacto nuevo que nace principal lo dice', () => {
    const v = presentarEvento(
      evento({ accion: 'contact_added', diff: { contacto: 'Ana Pérez', principal: true } }),
    )
    expect(v.titulo).toBe('Se agregó un contacto: Ana Pérez')
    expect(v.detalles).toEqual(['Quedó marcado como principal'])
  })

  it('marcar y desmarcar el principal se leen distinto', () => {
    const marca = presentarEvento(
      evento({ accion: 'contact_updated', diff: { is_default: { from: false, to: true } } }),
    )
    expect(marca.detalles).toEqual(['Pasó a ser el principal'])
    const desmarca = presentarEvento(
      evento({ accion: 'contact_updated', diff: { is_default: { from: true, to: false } } }),
    )
    expect(desmarca.detalles).toEqual(['Dejó de ser el principal'])
  })

  it('desactivar y reactivar se dicen así, no como «cambió si está activo»', () => {
    expect(
      presentarEvento(evento({ accion: 'contact_updated', diff: { active: { from: true, to: false } } }))
        .detalles,
    ).toEqual(['Se desactivó'])
    expect(
      presentarEvento(evento({ accion: 'contact_updated', diff: { active: { from: false, to: true } } }))
        .detalles,
    ).toEqual(['Se reactivó'])
  })

  it('cambiar el tipo de dirección lo traduce en los dos extremos', () => {
    const v = presentarEvento(
      evento({ accion: 'address_updated', diff: { kind: { from: 'billing', to: 'both' } } }),
    )
    expect(v.detalles).toEqual([
      'Cambió el tipo de dirección: de facturación a entrega y facturación',
    ])
  })

  it('un adjunto se nombra por su archivo y su clase', () => {
    const v = presentarEvento(
      evento({
        accion: 'attachment_added',
        diff: { archivo: 'contrato.pdf', clase: 'other', bytes: 12345, tipo: 'application/pdf' },
      }),
    )
    expect(v.titulo).toBe('Se adjuntó un archivo: contrato.pdf')
    expect(v.detalles).toEqual(['General'])
  })

  it('borrar un adjunto se distingue de agregarlo', () => {
    const v = presentarEvento(
      evento({ accion: 'attachment_deleted', diff: { archivo: 'viejo.pdf', clase: 'customer_po' } }),
    )
    expect(v.titulo).toBe('Se borró un adjunto: viejo.pdf')
    expect(v.detalles).toEqual(['Orden de compra'])
  })

  it('un cambio de estado se dice aparte del diff', () => {
    const v = presentarEvento(evento({ accion: 'deactivated', desde: 'active', hasta: 'inactive' }))
    expect(v.titulo).toBe('Se dio de baja el cliente')
    expect(v.detalles).toEqual(['Estado: de active a inactive'])
  })
})
