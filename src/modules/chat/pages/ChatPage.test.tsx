// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Conversacion, MensajeChat, UsuarioDeChat } from '../types'

const estado = vi.hoisted(() => ({
  rol: 'employee',
  conversaciones: [] as Conversacion[],
  mensajes: [] as MensajeChat[],
  usuarios: [] as UsuarioDeChat[],
}))

const espias = vi.hoisted(() => ({
  abrir: vi.fn((_c: string, otro: string) => Promise.resolve(`conv-de-${otro}`)),
  enviar: vi.fn((_c: string, _t: string) => Promise.resolve()),
  leido: vi.fn((_c: string) => Promise.resolve()),
}))

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true } }),
}))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'yo' } }) }))
// El canal en vivo no se monta en los tests: lo que se prueba es la pantalla.
vi.mock('../services/realtime', () => ({ suscribirChat: () => () => {} }))
vi.mock('../services/chat', () => ({
  listarChats: () => Promise.resolve(estado.conversaciones),
  usuariosParaChat: () => Promise.resolve(estado.usuarios),
  mensajesDeChat: () => Promise.resolve(estado.mensajes),
  abrirChatDirecto: espias.abrir,
  enviarMensaje: espias.enviar,
  marcarChatLeido: espias.leido,
  contarChatsSinLeer: () => Promise.resolve(0),
}))

const { ChatPage } = await import('./ChatPage')

const conversacion = (p: Partial<Conversacion> = {}): Conversacion => ({
  id: 'conv-1',
  conQuien: 'Norberto',
  conQuienId: 'u-norberto',
  ultimoMensaje: '¿Saliste el remito?',
  ultimoMensajeEn: '2026-09-25T12:00:00Z',
  sinLeer: 0,
  ...p,
})

const mensaje = (p: Partial<MensajeChat> = {}): MensajeChat => ({
  id: 'm1',
  conversacionId: 'conv-1',
  autorId: 'u-norberto',
  autorNombre: 'Norberto',
  texto: '¿Saliste el remito?',
  creadoEn: '2026-09-25T12:00:00Z',
  esMio: false,
  ...p,
})

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  estado.rol = 'employee'
  estado.conversaciones = [conversacion()]
  estado.mensajes = [mensaje()]
  estado.usuarios = [{ id: 'u-norberto', nombre: 'Norberto', rol: 'employee' }]
  vi.clearAllMocks()
})

describe('El chat interno', () => {
  it('lista las conversaciones con quién y su último mensaje', async () => {
    montar()
    const lista = await screen.findByRole('complementary', { name: 'Conversaciones' })
    expect(await within(lista).findByText('Norberto')).toBeInTheDocument()
    expect(within(lista).getByText('¿Saliste el remito?')).toBeInTheDocument()
  })

  it('al abrir una conversación se ven los mensajes, con quién los escribió', async () => {
    estado.mensajes = [mensaje(), mensaje({ id: 'm2', autorId: 'yo', autorNombre: 'Jano', texto: 'Sale hoy', esMio: true })]
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Norberto/ }, { timeout: 3000 }))

    const charla = await screen.findByRole('log', { name: 'Mensajes' })
    expect(await within(charla).findByText('¿Saliste el remito?')).toBeInTheDocument()
    expect(within(charla).getByText('Sale hoy')).toBeInTheDocument()
    // Quién habló va con TEXTO, no sólo con el color de la burbuja.
    expect(within(charla).getByText('Vos')).toBeInTheDocument()
    expect(within(charla).getByText('Norberto')).toBeInTheDocument()
  })

  it('mirar una conversación la marca leída', async () => {
    estado.conversaciones = [conversacion({ sinLeer: 3 })]
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Norberto/ }, { timeout: 3000 }))
    await waitFor(() => expect(espias.leido).toHaveBeenCalledWith('conv-1'))
  })

  it('escribir y mandar llama al servidor con el texto limpio', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Norberto/ }, { timeout: 3000 }))
    const campo = await screen.findByRole('textbox', { name: 'Escribí un mensaje' })
    fireEvent.change(campo, { target: { value: '  Sale mañana  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(espias.enviar).toHaveBeenCalledWith('conv-1', 'Sale mañana'))
  })

  /** Enter manda; Shift+Enter hace un renglón. Es lo que espera cualquiera. */
  it('Enter manda y Shift+Enter no', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Norberto/ }, { timeout: 3000 }))
    const campo = await screen.findByRole('textbox', { name: 'Escribí un mensaje' })

    fireEvent.change(campo, { target: { value: 'Hola' } })
    fireEvent.keyDown(campo, { key: 'Enter', shiftKey: true })
    expect(espias.enviar).not.toHaveBeenCalled()

    fireEvent.keyDown(campo, { key: 'Enter' })
    await waitFor(() => expect(espias.enviar).toHaveBeenCalledWith('conv-1', 'Hola'))
  })

  it('un mensaje vacío no se manda', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Norberto/ }, { timeout: 3000 }))
    const campo = await screen.findByRole('textbox', { name: 'Escribí un mensaje' })
    fireEvent.change(campo, { target: { value: '   ' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(espias.enviar).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
  })

  /**
   * Fase 28 · E16: el equipo entero aparece desde el primer día, con o sin
   * conversación. Hablarle a alguien por primera vez crea la conversación al
   * mandar el mensaje, no antes: así no queda una vacía si el envío falla.
   */
  it('a alguien con quien no se habló nunca se le puede escribir igual', async () => {
    estado.conversaciones = [conversacion({ id: null, ultimoMensaje: null, ultimoMensajeEn: null })]
    estado.mensajes = []
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Norberto/ }, { timeout: 3000 }))

    const campo = await screen.findByRole('textbox', { name: 'Escribí un mensaje' })
    fireEvent.change(campo, { target: { value: 'Hola' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => expect(espias.abrir).toHaveBeenCalledWith('c1', 'u-norberto'))
    await waitFor(() => expect(espias.enviar).toHaveBeenCalledWith('conv-de-u-norberto', 'Hola'))
  })

  it('con una conversación ya abierta no se crea otra', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Norberto/ }, { timeout: 3000 }))
    const campo = await screen.findByRole('textbox', { name: 'Escribí un mensaje' })
    fireEvent.change(campo, { target: { value: 'Hola' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(espias.enviar).toHaveBeenCalledWith('conv-1', 'Hola'))
    expect(espias.abrir).not.toHaveBeenCalled()
  })

  it('sin nadie más en el equipo lo dice en vez de dejar la pantalla vacía', async () => {
    estado.conversaciones = []
    montar()
    expect(await screen.findByText(/Todavía no hay nadie más en el equipo/)).toBeInTheDocument()
  })

  // La pantalla no es el control de acceso —lo son la RLS y las RPC— pero no
  // le ofrece a un cliente algo que la base le va a rechazar.
  it('un rol de afuera no ve el chat', async () => {
    estado.rol = 'customer'
    montar()
    expect(await screen.findByText('Tu rol no usa el chat interno')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Conversaciones' })).toBeNull()
  })
})
