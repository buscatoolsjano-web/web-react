// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Notificacion } from '@/features/notificaciones/servicio'

/**
 * El globito de la campana (Fase 161).
 *
 * El bicho: abrías el panel, el globito bajaba, pero al RECARGAR volvía a
 * subir. `visto` —hasta cuándo ya las viste— vivía en un `useState` con
 * inicializador, que corre una sola vez en el primer render, cuando la empresa
 * y el usuario todavía son `null`: leía la clave equivocada y nunca la volvía a
 * leer. Se arregló leyéndolo en cada render, con empresa y usuario reales.
 */
const estado = vi.hoisted(() => ({
  activa: null as { companyId: string; rol: string } | null,
  user: null as { id: string } | null,
  notis: [] as Notificacion[],
}))

const misNotif = vi.hoisted(() => vi.fn((_c: string, _u: string) => Promise.resolve(estado.notis)))

vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: estado.user }) }))
vi.mock('@/features/empresa/useEmpresa', () => ({ useEmpresa: () => ({ activa: estado.activa }) }))
vi.mock('@/features/notificaciones/servicio', () => ({ misNotificaciones: misNotif }))
vi.mock('./useNoLeidos', () => ({ useNoLeidos: () => ({ chat: 0 }) }))
// Los paneles son perezosos y traen voz/asistente: acá no se abren, se mockean.
vi.mock('@/features/notificaciones/PanelNotificaciones', () => ({ PanelNotificaciones: () => <div /> }))
vi.mock('@/features/notificaciones/PanelAsistente', () => ({ PanelAsistente: () => <div /> }))
vi.mock('@/modules/cata/components/PanelCata', () => ({ PanelCata: () => <div /> }))

const { BotonesHeader } = await import('./BotonesHeader')

const CLAVE = 'bt-notif-visto:c1:u1'

const unaNoti = (cuando: string): Notificacion => ({
  id: 'chat:9',
  tipo: 'chat',
  de: 'Facundo',
  titulo: 'Te escribió un mensaje',
  detalle: '¿Saliste el remito?',
  cuando,
  destino: '/chat',
})

function ui() {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <BotonesHeader />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const campana = () => screen.getByRole('button', { name: /Notificaciones/ })

beforeEach(() => {
  localStorage.clear()
  misNotif.mockClear()
  estado.activa = { companyId: 'c1', rol: 'admin' }
  estado.user = { id: 'u1' }
  estado.notis = []
})

describe('El globito de notificaciones', () => {
  it('sin un «visto» guardado, una notificación reciente lo prende', async () => {
    estado.notis = [unaNoti(new Date(Date.now() - 5 * 60_000).toISOString())]
    render(ui())
    await waitFor(() => expect(campana()).toHaveAccessibleName('Notificaciones: 1 sin ver'))
  })

  /**
   * El bicho exacto: se abrió antes (hay un `visto` guardado posterior a la
   * noti), pero al montar la empresa y el usuario aún no llegaron. Antes el
   * globito se prendía igual porque `visto` había quedado congelado en vacío;
   * ahora se lee en cada render y, cuando llegan empresa y usuario, queda bajo.
   */
  it('con un «visto» guardado, NO se prende al recargar aunque empresa/usuario lleguen tarde', async () => {
    localStorage.setItem(CLAVE, new Date().toISOString()) // ya se abrió antes
    estado.notis = [unaNoti(new Date(Date.now() - 5 * 60_000).toISOString())]

    // Primer render: la sesión todavía no cargó.
    estado.activa = null
    estado.user = null
    const { rerender } = render(ui())
    expect(misNotif).not.toHaveBeenCalled() // la query está desactivada sin empresa/usuario

    // Llegan empresa y usuario (sesión cargada).
    estado.activa = { companyId: 'c1', rol: 'admin' }
    estado.user = { id: 'u1' }
    rerender(ui())

    await waitFor(() => expect(misNotif).toHaveBeenCalledWith('c1', 'u1'))
    // Que la query resuelva y repinte con sus datos.
    await act(async () => { await Promise.resolve() })

    // El globito sigue APAGADO: `visto` (ahora) es posterior a la noti (hace 5').
    expect(campana()).toHaveAccessibleName('Notificaciones')
  })

  it('abrir el panel guarda el «visto» en localStorage para la empresa/usuario reales', async () => {
    estado.notis = [unaNoti(new Date(Date.now() - 5 * 60_000).toISOString())]
    render(ui())
    await waitFor(() => expect(campana()).toHaveAccessibleName('Notificaciones: 1 sin ver'))

    act(() => campana().click())

    // Quedó persistido: al recargar, el globito ya no vuelve a subir.
    expect(localStorage.getItem(CLAVE)).not.toBeNull()
    await waitFor(() => expect(campana()).toHaveAccessibleName('Notificaciones'))
  })
})
