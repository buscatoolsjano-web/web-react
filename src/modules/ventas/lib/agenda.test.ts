import { describe, expect, it } from 'vitest'
import { sugerirDeLaAgenda, type AgendaDelCliente } from './defaults'
import { borradorNuevo, cambiarCampo, cambiarCliente } from './borrador'
import type { CampoCabecera } from './borrador'

/**
 * El contacto y el domicilio de entrega que sugiere el cliente (Fase 17 · E3).
 *
 * Es la regla más conservadora del módulo: llena lo que está **vacío** y nadie
 * tocó, y nada más. Cada caso de abajo es una forma de equivocarse que no
 * queremos: sugerir a alguien que ya no atiende, mandar mercadería a un
 * domicilio dado de baja, pisar lo que la persona eligió, o adivinar cuando el
 * cliente no marcó ningún principal.
 */

const agenda = (p: Partial<AgendaDelCliente> = {}): AgendaDelCliente => ({
  contactos: [],
  direcciones: [],
  ...p,
})

const conCliente = (customerId = 'c1') =>
  cambiarCliente(borradorNuevo('2026-09-17'), customerId).borrador

const nada = new Set<CampoCabecera>()

describe('sugerirDeLaAgenda (Fase 17 · E3)', () => {
  it('sugiere el contacto principal y el domicilio de entrega principal', () => {
    const r = sugerirDeLaAgenda(
      conCliente(),
      agenda({
        contactos: [
          { id: 'k1', esPrincipal: false, activo: true },
          { id: 'k2', esPrincipal: true, activo: true },
        ],
        direcciones: [
          { id: 'd1', esPrincipal: false, activa: true },
          { id: 'd2', esPrincipal: true, activa: true },
        ],
      }),
      nada,
    )
    expect(r.borrador.cabecera.contactoId).toBe('k2')
    expect(r.borrador.cabecera.direccionEntregaId).toBe('d2')
    expect(r.aplicados).toEqual(['contactoId', 'direccionEntregaId'])
  })

  it('sin cliente elegido no sugiere nada', () => {
    const r = sugerirDeLaAgenda(
      borradorNuevo('2026-09-17'),
      agenda({ contactos: [{ id: 'k1', esPrincipal: true, activo: true }] }),
      nada,
    )
    expect(r.borrador.cabecera.contactoId).toBe('')
    expect(r.aplicados).toEqual([])
  })

  it('si el cliente no marcó ningún principal, no elige «el primero que haya»', () => {
    const r = sugerirDeLaAgenda(
      conCliente(),
      agenda({
        contactos: [
          { id: 'k1', esPrincipal: false, activo: true },
          { id: 'k2', esPrincipal: false, activo: true },
        ],
        direcciones: [{ id: 'd1', esPrincipal: false, activa: true }],
      }),
      nada,
    )
    expect(r.borrador.cabecera.contactoId).toBe('')
    expect(r.borrador.cabecera.direccionEntregaId).toBe('')
    expect(r.aplicados).toEqual([])
  })

  it('un principal DESACTIVADO no se sugiere', () => {
    const r = sugerirDeLaAgenda(
      conCliente(),
      agenda({
        contactos: [{ id: 'k1', esPrincipal: true, activo: false }],
        direcciones: [{ id: 'd1', esPrincipal: true, activa: false }],
      }),
      nada,
    )
    expect(r.borrador.cabecera.contactoId).toBe('')
    expect(r.borrador.cabecera.direccionEntregaId).toBe('')
    expect(r.aplicados).toEqual([])
  })

  it('no pisa lo que la persona eligió, aunque haya un principal', () => {
    let b = conCliente()
    b = cambiarCampo(b, 'contactoId', 'k9')
    b = cambiarCampo(b, 'direccionEntregaId', 'd9')
    const r = sugerirDeLaAgenda(
      b,
      agenda({
        contactos: [{ id: 'k1', esPrincipal: true, activo: true }],
        direcciones: [{ id: 'd1', esPrincipal: true, activa: true }],
      }),
      new Set<CampoCabecera>(['contactoId', 'direccionEntregaId']),
    )
    expect(r.borrador.cabecera.contactoId).toBe('k9')
    expect(r.borrador.cabecera.direccionEntregaId).toBe('d9')
    expect(r.aplicados).toEqual([])
  })

  it('tampoco pisa un valor que ya está puesto, ni siquiera sin marcarlo como tocado', () => {
    const b = cambiarCampo(conCliente(), 'contactoId', 'k9')
    const r = sugerirDeLaAgenda(
      b,
      agenda({ contactos: [{ id: 'k1', esPrincipal: true, activo: true }] }),
      nada,
    )
    expect(r.borrador.cabecera.contactoId).toBe('k9')
  })

  it('«sin elegir» es una elección: si tocaron el campo y lo dejaron vacío, se respeta', () => {
    const r = sugerirDeLaAgenda(
      conCliente(),
      agenda({ direcciones: [{ id: 'd1', esPrincipal: true, activa: true }] }),
      new Set<CampoCabecera>(['direccionEntregaId']),
    )
    expect(r.borrador.cabecera.direccionEntregaId).toBe('')
  })

  it('correr dos veces no cambia nada la segunda: es idempotente', () => {
    const a = agenda({
      contactos: [{ id: 'k1', esPrincipal: true, activo: true }],
      direcciones: [{ id: 'd1', esPrincipal: true, activa: true }],
    })
    const uno = sugerirDeLaAgenda(conCliente(), a, nada)
    const dos = sugerirDeLaAgenda(uno.borrador, a, nada)
    expect(dos.aplicados).toEqual([])
    // Y devuelve el MISMO objeto, así que un efecto de React no vuelve a
    // renderizar por gusto.
    expect(dos.borrador).toBe(uno.borrador)
  })

  it('cambiar de cliente limpia las dos cosas, y después entra lo del cliente nuevo', () => {
    const primero = sugerirDeLaAgenda(
      conCliente('c1'),
      agenda({
        contactos: [{ id: 'k1', esPrincipal: true, activo: true }],
        direcciones: [{ id: 'd1', esPrincipal: true, activa: true }],
      }),
      nada,
    ).borrador
    expect(primero.cabecera.contactoId).toBe('k1')

    const cambiado = cambiarCliente(primero, 'c2').borrador
    expect(cambiado.cabecera.contactoId).toBe('')
    expect(cambiado.cabecera.direccionEntregaId).toBe('')

    const segundo = sugerirDeLaAgenda(
      cambiado,
      agenda({
        contactos: [{ id: 'k7', esPrincipal: true, activo: true }],
        direcciones: [{ id: 'd7', esPrincipal: true, activa: true }],
      }),
      nada,
    )
    expect(segundo.borrador.cabecera.contactoId).toBe('k7')
    expect(segundo.borrador.cabecera.direccionEntregaId).toBe('d7')
  })

  it('un cliente con contactos pero sin domicilios sugiere sólo el contacto', () => {
    const r = sugerirDeLaAgenda(
      conCliente(),
      agenda({ contactos: [{ id: 'k1', esPrincipal: true, activo: true }] }),
      nada,
    )
    expect(r.borrador.cabecera.contactoId).toBe('k1')
    expect(r.borrador.cabecera.direccionEntregaId).toBe('')
    expect(r.aplicados).toEqual(['contactoId'])
  })

  it('no toca las líneas ni ningún otro campo de la cabecera', () => {
    const b = cambiarCampo(conCliente(), 'moneda', 'USD')
    const r = sugerirDeLaAgenda(
      b,
      agenda({ contactos: [{ id: 'k1', esPrincipal: true, activo: true }] }),
      nada,
    )
    expect(r.borrador.cabecera.moneda).toBe('USD')
    expect(r.borrador.lineas).toBe(b.lineas)
  })
})
