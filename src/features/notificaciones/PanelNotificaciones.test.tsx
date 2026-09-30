// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type * as Router from 'react-router-dom'
import type { Notificacion } from './servicio'

/**
 * El panel de notificaciones (Fase 33 · E1).
 *
 * Lo que se prueba es lo que lo hace confiable: que el vacío EXPLIQUE qué
 * avisa —si no, no se sabe si funciona o si no hay nada—, que tocar una lleve
 * a donde corresponde, y que un fallo de una fuente no se lleve puesta a la
 * otra.
 */
const estado = vi.hoisted(() => ({ datos: [] as Notificacion[], destino: '' }))

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', rol: 'admin', esInterno: true } }),
}))
vi.mock('./servicio', () => ({ misNotificaciones: () => Promise.resolve(estado.datos) }))
vi.mock('react-router-dom', async (original) => {
  const real = await original<typeof Router>()
  return { ...real, useNavigate: () => (d: string) => { estado.destino = d } }
})

const { PanelNotificaciones } = await import('./PanelNotificaciones')

const cerrar = vi.fn()

function montar() {
  estado.destino = ''
  cerrar.mockClear()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <PanelNotificaciones onCerrar={cerrar} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const unMail = (): Notificacion => ({
  id: 'email:1',
  tipo: 'email',
  de: 'compras@mirgor.com',
  titulo: 'Orden de compra 4500123',
  detalle: 'Adjunto la OC para las puntas.',
  cuando: new Date(Date.now() - 5 * 60_000).toISOString(),
  destino: '/emails',
})

describe('El panel de notificaciones', () => {
  /**
   * Un «no tenés notificaciones» a secas deja pensando si esto anda. Si dice
   * QUÉ avisa, el vacío es una respuesta y no una duda.
   */
  it('cuando no hay nada, explica qué es lo que avisa', async () => {
    estado.datos = []
    montar()

    expect(await screen.findByText(/No tenés nada pendiente/i)).toBeInTheDocument()
    expect(screen.getByText(/te asignen un correo/i)).toBeInTheDocument()
    expect(screen.getByText(/te escriba por el chat/i)).toBeInTheDocument()
  })

  it('muestra de quién es, qué dice y hace cuánto', async () => {
    estado.datos = [unMail()]
    montar()

    expect(await screen.findByText('compras@mirgor.com')).toBeInTheDocument()
    expect(screen.getByText('Orden de compra 4500123')).toBeInTheDocument()
    expect(screen.getByText('Adjunto la OC para las puntas.')).toBeInTheDocument()
    expect(screen.getByText('hace 5 min')).toBeInTheDocument()
  })

  it('tocarla lleva a su pantalla y cierra el panel', async () => {
    estado.datos = [unMail()]
    montar()

    fireEvent.click(await screen.findByRole('button', { name: /compras@mirgor\.com/i }))
    expect(estado.destino).toBe('/emails')
    // Se cierra: dejarlo abierto sobre la pantalla a la que acaba de llevar
    // obliga a un segundo clic para ver lo que uno fue a ver.
    expect(cerrar).toHaveBeenCalled()
  })

  it('un mensaje de chat lleva al chat', async () => {
    estado.datos = [{
      id: 'chat:9', tipo: 'chat', de: 'Facundo',
      titulo: 'Te escribió 3 mensajes', detalle: '¿Saliste el remito?',
      cuando: new Date().toISOString(), destino: '/chat',
    }]
    montar()

    fireEvent.click(await screen.findByRole('button', { name: /Facundo/i }))
    expect(estado.destino).toBe('/chat')
  })

  /**
   * El caso que motivó todo: el 28/09 el correo dejó de entrar y NADA avisó.
   * Un aviso de que la bandeja se cortó no sirve escondido en configuración:
   * va acá, arriba de todo, que es donde la gente ya mira.
   */
  it('un problema de la bandeja aparece como alerta y va PRIMERO', async () => {
    estado.datos = [
      {
        id: 'alerta:watch_vencido:info@buscatools.com.ar', tipo: 'alerta',
        de: 'info@buscatools.com.ar', titulo: 'El correo NO está entrando',
        detalle: 'El permiso de Gmail venció el 28/09 a las 14:20.',
        cuando: null, destino: '/emails',
      },
      unMail(),
    ]
    montar()

    expect(await screen.findByText('El correo NO está entrando')).toBeInTheDocument()
    const filas = screen.getAllByRole('button').filter((b) => b.textContent?.includes('@'))
    expect(filas[0]?.textContent).toContain('El correo NO está entrando')
  })
})