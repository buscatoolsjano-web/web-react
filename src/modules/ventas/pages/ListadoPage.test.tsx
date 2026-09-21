// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const estado = vi.hoisted(() => ({
  rol: 'admin',
  stel: false,
  cargandoAutoridad: false,
  movil: false,
  filas: 2,
  error: false,
  hayFiltros: false,
  // Fase 19 · E3: las series del tipo, con su autoridad efectiva. Sin ninguna
  // que numere el ERP —el caso de los pedidos y los remitos— la puerta del
  // alta sigue cerrada por la autoridad general.
  series: [] as { codigo: string; esPorDefecto: boolean; autoridad: string }[],
  seriesPendientes: false,
}))
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
  useSeries: () => ({ data: estado.series, isPending: estado.seriesPendientes }),
  useFacetas: () => ({ data: { monedas: ['USD'], series: ['COTI'] } }),
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

function montar(tipo: 'cotizacion' | 'pedido' = 'cotizacion') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        {tipo === 'pedido' ? (
          <ListadoPage tipo="pedido" titulo="Pedidos" etiquetaOrigen={null} rutaNuevo="/ventas/pedidos/nuevo" etiquetaNuevo="Nuevo pedido" />
        ) : (
          <ListadoPage tipo="cotizacion" titulo="Cotizaciones" etiquetaOrigen={null} rutaNuevo="/ventas/cotizaciones/nueva" etiquetaNuevo="Nueva cotización" />
        )}
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  Object.assign(estado, { rol: 'admin', stel: false, cargandoAutoridad: false, movil: false, filas: 2, error: false, hayFiltros: false, series: [], seriesPendientes: false })
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

/**
 * Fase 19 · E3 · §7-A/B/C. La autoridad decide si se puede CREAR, no si se
 * puede ABRIR el alta: con una serie que el ERP numera, el botón lleva al
 * formulario y ahí decide la serie elegida.
 */
describe('Listado de Ventas: la puerta del alta con una serie del ERP', () => {
  const DOS = [
    { codigo: 'COTI', esPorDefecto: true, autoridad: 'STEL' },
    { codigo: 'COT-ERP', esPorDefecto: false, autoridad: 'ERP' },
  ]

  it.each(['admin', 'employee'])('%s entra al alta aunque la serie por defecto la numere STEL', (rol) => {
    estado.rol = rol
    estado.stel = true
    estado.series = DOS
    montar()
    expect(screen.getByRole('link', { name: 'Nueva cotización' })).toHaveAttribute('href', '/ventas/cotizaciones/nueva')
    expect(screen.queryByRole('button', { name: 'Nueva cotización' })).toBeNull()
    // Y el cartel no puede seguir diciendo que crear está bloqueado.
    const aviso = screen.getByTestId('aviso-autoridad-stel')
    expect(aviso).toHaveTextContent(/elegir una serie del ERP al crear/)
    // Y el título tampoco puede decir que STEL administra todo.
    expect(aviso).toHaveTextContent('STEL sigue administrando la numeración de la serie por defecto.')
    expect(document.getElementById('motivo-nueva')).toBeNull()
  })

  it.each(['salesperson', 'technician', 'customer'])('%s sigue sin acción de alta: la serie no cambia los roles', (rol) => {
    estado.rol = rol
    estado.stel = true
    estado.series = DOS
    montar()
    expect(screen.queryByRole('link', { name: 'Nueva cotización' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Nueva cotización' })).toBeNull()
  })

  it('sin ninguna serie del ERP la puerta sigue cerrada, con su motivo', () => {
    estado.stel = true
    estado.series = [{ codigo: 'COTI', esPorDefecto: true, autoridad: 'STEL' }]
    montar()
    const nueva = screen.getByRole('button', { name: 'Nueva cotización' })
    expect(nueva).toBeDisabled()
    expect(document.getElementById('motivo-nueva')).toHaveTextContent(/STEL numera las cotizaciones/)
  })

  it('mientras las series no llegaron no se promete nada: deshabilitada y sin motivo', () => {
    estado.stel = true
    estado.seriesPendientes = true
    montar()
    expect(screen.getByRole('button', { name: 'Nueva cotización' })).toBeDisabled()
    expect(document.getElementById('motivo-nueva')).toBeNull()
  })

  it('el vacío también invita a crear cuando la puerta está abierta', () => {
    estado.stel = true
    estado.series = DOS
    estado.filas = 0
    montar()
    expect(screen.getAllByRole('link', { name: 'Nueva cotización' }).length).toBeGreaterThan(0)
  })
})

/**
 * Fase 19 · E5: el alta de PEDIDO también elige serie desde la E4, así que su
 * puerta se abre con la misma regla. El selector existía en una pantalla a la
 * que desde el listado no se llegaba.
 */
describe('Listado de Pedidos: la puerta del alta', () => {
  it('con una serie del ERP, «Nuevo pedido» lleva al alta', () => {
    estado.stel = true
    estado.series = [
      { codigo: 'PDV', esPorDefecto: true, autoridad: 'STEL' },
      { codigo: 'PDV-ERP', esPorDefecto: false, autoridad: 'ERP' },
    ]
    montar('pedido')
    expect(screen.getByRole('link', { name: 'Nuevo pedido' })).toHaveAttribute('href', '/ventas/pedidos/nuevo')
    expect(screen.getByTestId('aviso-autoridad-stel')).toHaveTextContent(/elegir una serie del ERP al crear/)
  })

  it('sin ninguna serie del ERP sigue cerrada', () => {
    estado.stel = true
    estado.series = [{ codigo: 'PDV', esPorDefecto: true, autoridad: 'STEL' }]
    montar('pedido')
    expect(screen.getByRole('button', { name: 'Nuevo pedido' })).toBeDisabled()
    expect(document.getElementById('motivo-nueva')).toHaveTextContent(/STEL numera los pedidos/)
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
