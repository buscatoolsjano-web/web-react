// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ClienteListado } from '../types'

const estado = vi.hoisted(() => ({ rol: 'admin', filas: [] as ClienteListado[], hayFiltros: false, movil: false }))
const llamadas = vi.hoisted(() => ({ aplicar: vi.fn(), limpiar: vi.fn() }))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true, customerId: null } }),
}))
vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => estado.movil, useMediaQuery: () => false }))
vi.mock('../services/clientes', () => ({ exportarClientes: vi.fn() }))
vi.mock('../hooks/useFiltrosClientes', () => ({
  TAMANOS_DE_PAGINA: [10, 25, 50, 100],
  useFiltrosClientes: () => ({
    filtros: { q: '', rubro: null, soloRevision: false, incluirBajas: false, pagina: 1, porPagina: 25, orden: 'nombre', direccion: 'asc' },
    aplicar: llamadas.aplicar,
    limpiar: llamadas.limpiar,
    hayFiltros: estado.hayFiltros,
  }),
}))
vi.mock('../hooks/useClientes', () => ({
  useRubros: () => ({ data: ['ZZ Metalmecánica'] }),
  useClientes: () => ({ data: { filas: estado.filas, total: estado.filas.length }, isPending: false, isFetching: false, error: null, refetch: vi.fn() }),
}))

const { ClientesPage } = await import('./ClientesPage')

const cliente = (i: number, extra: Partial<ClienteListado> = {}): ClienteListado => ({
  id: `c${i}`,
  referencia: `CLI0000${i}`,
  razonSocial: `ZZ Cliente ${i} SA`,
  nombreComercial: null,
  cuit: '30712345671',
  emails: [],
  dominios: [],
  rubro: null,
  telefono: null,
  esHistorico: false,
  necesitaRevision: false,
  motivosRevision: [],
  dadoDeBaja: false,
  ...extra,
})

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ClientesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  Object.assign(estado, { rol: 'admin', filas: [], hayFiltros: false, movil: false })
  vi.clearAllMocks()
})

describe('Listado de clientes (Fase 13 · E4)', () => {
  it.each(['admin', 'employee', 'salesperson'])('%s ve «Nuevo cliente» (customers_insert)', (rol) => {
    estado.rol = rol
    estado.filas = [cliente(1)]
    montar()
    expect(screen.getByRole('link', { name: 'Nuevo cliente' })).toHaveAttribute('href', '/clientes/nuevo')
  })

  it.each(['technician', 'customer'])('%s no ve «Nuevo cliente»', (rol) => {
    estado.rol = rol
    estado.filas = [cliente(1)]
    montar()
    expect(screen.queryByRole('link', { name: 'Nuevo cliente' })).toBeNull()
  })

  it('estados con texto (Badge) y paginación común en singular', () => {
    estado.filas = [cliente(1, { necesitaRevision: true, motivosRevision: ['cuit'], dadoDeBaja: true })]
    montar()
    expect(screen.getByText('1 cliente')).toBeInTheDocument()
    expect(screen.getByText('1 observación')).toBeInTheDocument()
    expect(screen.getByText('Dado de baja')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Paginación' })).toHaveTextContent('1–1 de 1 cliente')
    expect(document.body).not.toHaveTextContent('⚠')
  })

  it('vacío con filtros ofrece limpiarlos; sin filtros invita a crear', () => {
    estado.hayFiltros = true
    const { unmount } = montar()
    expect(screen.getByRole('heading', { name: 'Sin resultados para estos filtros' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Limpiar filtros' }).at(-1)!)
    expect(llamadas.limpiar).toHaveBeenCalled()
    unmount()
    estado.hayFiltros = false
    montar()
    expect(screen.getByRole('heading', { name: 'Todavía no hay clientes' })).toBeInTheDocument()
  })

  it('mobile: filtros plegados (rubro y casillas detrás de «Filtros»), tarjetas enlazadas', () => {
    estado.movil = true
    estado.filas = [cliente(1)]
    montar()
    const plegar = screen.getByRole('button', { name: /Filtros/ })
    expect(plegar).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById(plegar.getAttribute('aria-controls')!)).toHaveAttribute('hidden')
    expect(screen.getByRole('link', { name: /ZZ Cliente 1 SA/ })).toHaveAttribute('href', '/clientes/c1')
  })
})
