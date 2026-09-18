// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import type { ClienteListado } from '../types'

/**
 * La cola de revisión (Fase 17 · E5).
 *
 * Lo que se prueba: que los motivos se lean en castellano, que resolver uno
 * mande exactamente ese motivo, que quien no puede resolver no vea el botón, y
 * que la cola **no ofrezca fusionar ni borrar** — lo único que corresponde acá
 * es abrir el cliente y mirar.
 */

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

const estado = vi.hoisted(() => ({
  rol: 'admin',
  filas: [] as ClienteListado[],
  total: 0,
  cargando: false,
  errorResolver: null as Error | null,
}))
const espias = vi.hoisted(() => ({ resolver: vi.fn((_m?: unknown, _o?: unknown) => {}) }))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({
    activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true, customerId: null },
  }),
}))
vi.mock('../hooks/useClientes', () => ({
  useColaDeRevision: () => ({
    data: { filas: estado.filas, total: estado.total },
    isPending: estado.cargando,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}))
vi.mock('../hooks/useEdicionClientes', () => ({
  useResolverRevision: () => ({
    mutate: espias.resolver,
    isPending: false,
    error: estado.errorResolver,
  }),
}))

const { ClientesRevisarPage } = await import('./ClientesRevisarPage')

const cliente = (p: Partial<ClienteListado> = {}): ClienteListado => ({
  id: 'c-uno',
  referencia: 'CLI00042',
  razonSocial: 'ZZ Alfa SA',
  nombreComercial: null,
  cuit: '30712345674',
  emails: [],
  dominios: [],
  rubro: null,
  telefono: null,
  esHistorico: true,
  necesitaRevision: true,
  motivosRevision: ['CUIT_REPETIDO_EN_LEGACY'],
  dadoDeBaja: false,
  ...p,
})

const montar = () => {
  const router = createMemoryRouter(
    [
      { path: '/clientes/revisar', element: <ClientesRevisarPage /> },
      { path: '/clientes', element: <p>listado</p> },
      { path: '/clientes/:id', element: <p>ficha del cliente</p> },
    ],
    { initialEntries: ['/clientes/revisar'] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  estado.rol = 'admin'
  estado.filas = [cliente()]
  estado.total = 1
  estado.cargando = false
  estado.errorResolver = null
  vi.clearAllMocks()
})

describe('Cola de revisión', () => {
  it('muestra el cliente con su motivo en castellano, no el código', () => {
    montar()
    expect(screen.getByRole('heading', { level: 1, name: 'Clientes para revisar' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ZZ Alfa SA' })).toHaveAttribute('href', '/clientes/c-uno')
    expect(screen.queryByText('CUIT_REPETIDO_EN_LEGACY')).not.toBeInTheDocument()
    expect(screen.getByText(/CUIT/)).toBeInTheDocument()
  })

  it('dice de dónde viene el cliente sin exponer su identidad interna', () => {
    montar()
    expect(screen.getByText(/CLI00042/)).toBeInTheDocument()
    expect(screen.getByText(/migrado del sistema anterior/)).toBeInTheDocument()
  })

  it('resolver manda exactamente el motivo que se apretó', () => {
    estado.filas = [cliente({ motivosRevision: ['CUIT_REPETIDO_EN_LEGACY', 'SOLO_EN_CONTACTOS'] })]
    montar()
    const botones = screen.getAllByRole('button', { name: 'Dar por revisado' })
    expect(botones).toHaveLength(2)
    fireEvent.click(botones[1]!)

    expect(espias.resolver).toHaveBeenCalledTimes(1)
    expect(espias.resolver.mock.calls[0]![0]).toEqual(['SOLO_EN_CONTACTOS'])
  })

  it('siempre ofrece abrir el cliente: revisar es mirar', () => {
    montar()
    // Los motivos también son <li>: se busca la tarjeta por su enlace al cliente.
    const tarjeta = screen.getByRole('link', { name: 'ZZ Alfa SA' }).closest('li')!
    expect(within(tarjeta).getByRole('link', { name: 'Abrir el cliente' })).toBeInTheDocument()
  })

  it('no ofrece fusionar ni borrar', () => {
    montar()
    expect(
      screen.queryByRole('button', { name: /fusionar|unificar|combinar|borrar|eliminar/i }),
    ).not.toBeInTheDocument()
  })

  it('un cliente dado de baja se ve marcado, no escondido', () => {
    estado.filas = [cliente({ dadoDeBaja: true })]
    montar()
    expect(screen.getByText('Dado de baja')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ZZ Alfa SA' })).toBeInTheDocument()
  })

  it('quien no puede resolver la lee pero no la toca', () => {
    estado.rol = 'salesperson'
    montar()
    expect(screen.queryByRole('button', { name: 'Dar por revisado' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ZZ Alfa SA' })).toBeInTheDocument()
  })

  it('sin nada que revisar lo dice, y ofrece volver al listado', () => {
    estado.filas = []
    estado.total = 0
    montar()
    expect(screen.getByText('No hay clientes para revisar')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir al listado' })).toBeInTheDocument()
  })

  it('con más de una página, el paginador dice cuántos hay en total', () => {
    estado.filas = Array.from({ length: 25 }, (_, i) => cliente({ id: `c-${i}`, razonSocial: `ZZ ${i}` }))
    estado.total = 40
    montar()
    expect(screen.getByText(/40 clientes marcados/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Siguiente/ })).toBeInTheDocument()
  })

  it('un error al resolver se dice y no borra la fila de la pantalla', () => {
    estado.errorResolver = new Error('No tenés permiso para resolver la revisión de este cliente')
    montar()
    expect(screen.getByRole('alert')).toHaveTextContent('No tenés permiso')
    expect(screen.getByRole('link', { name: 'ZZ Alfa SA' })).toBeInTheDocument()
  })
})
