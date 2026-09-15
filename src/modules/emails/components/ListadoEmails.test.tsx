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
})
