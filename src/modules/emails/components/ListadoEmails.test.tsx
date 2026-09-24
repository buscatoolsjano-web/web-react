// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { FilaBandeja } from '../types'
import { ListadoEmails } from './ListadoEmails'

const fila = (p: Partial<FilaBandeja> = {}): FilaBandeja => ({
  id: 'h1',
  accountId: 'a1',
  gmailThreadId: 'g1',
  asunto: 'Pedido de cotización',
  extracto: 'Necesitamos precio',
  ultimoMensajeEn: '2026-09-14T15:00:00Z',
  ultimoRemitente: 'Cliente Uno',
  ultimaDireccion: 'in',
  participantes: ['cliente@ejemplo.test', 'buzon@ejemplo.test'],
  cantidadMensajes: 3,
  tieneAdjuntos: true,
  estado: 'en_proceso',
  asignadoA: null,
  asignadoNombre: null,
  clienteId: null,
  clienteNombre: null,
  vinculoOrigen: null,
  sinLeer: true,
  eliminado: false,
  ...p,
})

describe('Bandeja de Emails (presentación)', () => {
  it('sin leer, estado y adjuntos se dicen con texto; sin emoji', () => {
    render(
      <MemoryRouter initialEntries={['/emails?estado=pendiente']}>
        <ListadoEmails filas={[fila(), fila({ id: 'h2', asunto: null, sinLeer: false, tieneAdjuntos: false, estado: 'resuelto', cantidadMensajes: 1 })]} buzones={new Map([['a1', 'buzon@ejemplo.test']])} />
      </MemoryRouter>,
    )
    const lista = screen.getByRole('list', { name: 'Hilos de correo' })
    const [primera, segunda] = within(lista).getAllByRole('link')
    expect(primera).toHaveAttribute('href', '/emails/h1')
    expect(within(primera!).getByText('Sin leer')).toBeInTheDocument()
    expect(within(primera!).getByText('En proceso')).toBeInTheDocument()
    expect(within(primera!).getByText('Tiene adjuntos')).toBeInTheDocument()
    expect(within(primera!).getByLabelText('3 mensajes')).toBeInTheDocument()
    expect(within(segunda!).queryByText('Sin leer')).toBeNull()
    expect(within(segunda!).getByText('(sin asunto)')).toBeInTheDocument()
    expect(within(segunda!).getByText('Resuelto')).toBeInTheDocument()
    expect(lista.textContent).not.toMatch(/\u{1F4CE}/u)
  })

  // Fase 28 · E2. El botón va afuera del enlace: un `<button>` dentro de un
  // `<a>` no es HTML válido y el teclado no llega a los dos.
  it('el botón de eliminar no está adentro del enlace', () => {
    render(
      <MemoryRouter>
        <ListadoEmails filas={[fila()]} buzones={new Map()} onEliminar={() => {}} />
      </MemoryRouter>,
    )
    const enlace = screen.getByRole('link')
    const boton = screen.getByRole('button', { name: 'Eliminar: Pedido de cotización' })
    expect(enlace.contains(boton)).toBe(false)
  })

  it('un hilo ya eliminado ofrece restaurarlo', () => {
    const tocados: [string, boolean][] = []
    render(
      <MemoryRouter>
        <ListadoEmails
          filas={[fila({ eliminado: true })]}
          buzones={new Map()}
          onEliminar={(f, quitar) => tocados.push([f.id, quitar])}
        />
      </MemoryRouter>,
    )
    const boton = screen.getByRole('button', { name: 'Restaurar: Pedido de cotización' })
    boton.click()
    expect(tocados).toEqual([['h1', false]])
  })

  it('sin `onEliminar` no se dibuja ningún botón', () => {
    render(
      <MemoryRouter>
        <ListadoEmails filas={[fila()]} buzones={new Map()} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })
})
