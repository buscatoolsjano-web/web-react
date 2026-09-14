// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const estado = vi.hoisted(() => ({ rol: 'admin', stel: false, cargandoAutoridad: false, movil: false, filas: 2, error: false, hayFiltros: false }))
const llamadas = vi.hoisted(() => ({ aplicar: vi.fn(), limpiar: vi.fn(), refetch: vi.fn() }))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true, customerId: null } }),
}))
vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => estado.movil, useMediaQuery: () => false }))
vi.mock('../services/acciones', () => ({ exportarCsv: vi.fn() }))
vi.mock('../hooks/useAutoridadNumeracion', () => ({
  useAutoridadNumeracion: () => ({ stel: () => estado.stel, cargando: estado.cargandoAutoridad }),
}))
vi.mock('../hooks/useFiltrosVentas', () => ({
  TAMANOS_DE_PAGINA: [10, 25, 50, 100],
  useFiltrosVentas: () => ({
    filtros: { q: '', clienteId: null, estado: null, moneda: null, desde: null, hasta: null, soloRevision: false, pagina: 1, porPagina: 25, orden: 'fecha', direccion: 'desc' },
    aplicar: llamadas.aplicar,
    limpiar: llamadas.limpiar,
    hayFiltros: estado.hayFiltros,
  }),
}))
vi.mock('../hooks/useDocumentos', () => ({
  useClientes: () => ({ data: [] }),
  useMonedas: () => ({ data: ['USD'] }),
  useDocumentos: () =>
    estado.error
      ? { data: undefined, isPending: false, isFetching: false, error: new Error('red'), refetch: llamadas.refetch }
      : {
          data: {
            total: estado.filas,
            filas: Array.from({ length: estado.filas }, (_, i) => ({
              id: `d${i}`,
              tipo: 'cotizacion',
              numero: `COTI-0000${i + 1}`,
              clienteNombre: 'ZZ Cliente',
              fecha: '2026-09-14',
              total: 100,
              moneda: 'USD',
              titulo: null,
              estado: 'draft',
              estadoSecundario: null,
              origen: null,
              vendedor: null,
              necesitaRevision: false,
              motivosRevision: [],
            })),
          },
          isPending: false,
          isFetching: false,
          error: null,
          refetch: llamadas.refetch,
        },
}))

const { ListadoPage } = await import('./ListadoPage')

function montar() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ListadoPage tipo="cotizacion" titulo="Cotizaciones" etiquetaOrigen={null} rutaNuevo="/ventas/cotizaciones/nueva" etiquetaNuevo="Nueva cotización" />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  Object.assign(estado, { rol: 'admin', stel: false, cargandoAutoridad: false, movil: false, filas: 2, error: false, hayFiltros: false })
  vi.clearAllMocks()
})

describe('Listado de Ventas: acción «Nueva» según el rol (Fase 13)', () => {
  it.each(['admin', 'employee'])('%s la ve como enlace al alta', (rol) => {
    estado.rol = rol
    montar()
    expect(screen.getByRole('link', { name: 'Nueva cotización' })).toHaveAttribute('href', '/ventas/cotizaciones/nueva')
  })

  it.each(['salesperson', 'technician', 'customer'])('%s no la ve (la base le rechazaría el alta)', (rol) => {
    estado.rol = rol
    montar()
    expect(screen.queryByRole('link', { name: 'Nueva cotización' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Nueva cotización' })).toBeNull()
  })

  it('STEL: banner visible, «Nueva» deshabilitada con el motivo asociado', () => {
    estado.stel = true
    montar()
    expect(screen.getByTestId('aviso-autoridad-stel')).toHaveTextContent('STEL sigue administrando la numeración de este documento.')
    const nueva = screen.getByRole('button', { name: 'Nueva cotización' })
    expect(nueva).toBeDisabled()
    expect(nueva).toHaveAttribute('aria-describedby', 'motivo-nueva')
    expect(document.getElementById('motivo-nueva')).toHaveTextContent(/STEL numera las cotizaciones/)
  })
})

describe('Listado de Ventas: estados', () => {
  it('h1, subtítulo en singular/plural y paginación común', () => {
    estado.filas = 1
    montar()
    expect(screen.getByRole('heading', { level: 1, name: 'Cotizaciones' })).toBeInTheDocument()
    expect(screen.getByText('1 cotización')).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Paginación' })).getByText('1–1 de 1 cotización')).toBeInTheDocument()
  })

  it('vacío sin filtros: invita a crear; con filtros: ofrece limpiarlos', () => {
    estado.filas = 0
    const { unmount } = montar()
    expect(screen.getByRole('heading', { name: 'Todavía no hay cotizaciones' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Nueva cotización' }).length).toBeGreaterThan(0)
    unmount()
    estado.hayFiltros = true
    montar()
    fireEvent.click(within(screen.getByText('Sin resultados para estos filtros').parentElement!).getByRole('button', { name: 'Limpiar filtros' }))
    expect(llamadas.limpiar).toHaveBeenCalled()
  })

  it('error: alerta con reintentar, sin quedar «Cargando…»', () => {
    estado.error = true
    montar()
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo leer el listado.')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(llamadas.refetch).toHaveBeenCalled()
  })

  it('mobile: filtros plegados detrás de «Filtros», la búsqueda queda a la vista', () => {
    estado.movil = true
    montar()
    expect(screen.getByRole('searchbox', { name: 'Buscar por número de documento' })).toBeVisible()
    const plegar = screen.getByRole('button', { name: /Filtros/ })
    expect(plegar).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('combobox', { name: 'Cliente', hidden: true }).closest('[hidden]')).not.toBeNull()
    fireEvent.click(plegar)
    expect(plegar).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('combobox', { name: 'Cliente' }).closest('[hidden]')).toBeNull()
  })
})
