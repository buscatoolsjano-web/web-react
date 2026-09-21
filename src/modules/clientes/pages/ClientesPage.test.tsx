// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ClienteListado } from '../types'

const estado = vi.hoisted(() => ({ rol: 'admin', filas: [] as ClienteListado[], hayFiltros: false, movil: false, ancho: true }))
const llamadas = vi.hoisted(() => ({ aplicar: vi.fn(), limpiar: vi.fn() }))
/** La ficha del panel: acá sólo importa QUÉ cliente se pidió, no su contenido. */
const ficha360 = vi.hoisted(() => vi.fn())

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true, customerId: null } }),
}))
vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => estado.movil, useMediaQuery: () => estado.ancho }))
vi.mock('../services/clientes', () => ({ exportarClientes: vi.fn() }))
vi.mock('../services/cliente360', () => ({ cliente360: ficha360 }))
vi.mock('@/modules/ventas/hooks/useAutoridadNumeracion', () => ({
  useAutoridadNumeracion: () => ({ stel: () => true, cargando: false }),
}))
// Fase 19 · E3: sin serie del ERP configurada, la puerta del alta sigue cerrada.
vi.mock('@/modules/ventas/hooks/useAperturaDeAlta', () => ({
  useAperturaDeAlta: () => ({ abierta: false, cargando: false }),
}))
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

const montar = (url = '/clientes') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <ClientesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  Object.assign(estado, { rol: 'admin', filas: [], hayFiltros: false, movil: false, ancho: true })
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

/**
 * Fase 19 · E1 — master/detail.
 *
 * Lo que se prueba acá es el comportamiento del listado, no el contenido de la
 * ficha (eso está en `FichaRapidaCliente.test.tsx`): que el click abra el
 * panel en vez de navegar, que el link siga siendo un link, y que abrir y
 * cerrar no se lleve puesto el trabajo hecho en la lista.
 */
describe('Ficha rápida desde el listado (Fase 19 · E1)', () => {
  const abrir = (n = 1) => fireEvent.click(screen.getByRole('link', { name: `ZZ Cliente ${n} SA` }))

  it('el click abre el panel y NO navega a la ficha completa', async () => {
    estado.filas = [cliente(1)]
    montar()
    abrir()
    expect(await screen.findByRole('complementary')).toBeInTheDocument()
    await waitFor(() => expect(ficha360).toHaveBeenCalledWith('c1', 12))
  })

  it('pero sigue siendo un link: Ctrl+click abre la ficha completa como siempre', () => {
    estado.filas = [cliente(1)]
    montar()
    const link = screen.getByRole('link', { name: 'ZZ Cliente 1 SA' })
    expect(link).toHaveAttribute('href', '/clientes/c1')
    fireEvent.click(link, { ctrlKey: true })
    // Con modificador no se intercepta nada: el panel no se abre.
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('un link directo con ?cliente= abre el panel al entrar', async () => {
    estado.filas = [cliente(1)]
    montar('/clientes?cliente=c1')
    expect(await screen.findByRole('complementary')).toBeInTheDocument()
  })

  it('cambiar de fila cambia el panel, sin cerrarlo', async () => {
    estado.filas = [cliente(1), cliente(2)]
    montar()
    abrir(1)
    await waitFor(() => expect(ficha360).toHaveBeenCalledWith('c1', 12))
    abrir(2)
    await waitFor(() => expect(ficha360).toHaveBeenCalledWith('c2', 12))
    expect(screen.getByRole('complementary')).toBeInTheDocument()
  })

  it('la fila abierta queda marcada, y sólo una', async () => {
    estado.filas = [cliente(1), cliente(2)]
    montar('/clientes?cliente=c2')
    await screen.findByRole('complementary')
    const marcadas = screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'true')
    expect(marcadas).toHaveLength(1)
    expect(marcadas[0]).toHaveAccessibleName('ZZ Cliente 2 SA')
  })

  it('cerrar deja el listado como estaba', async () => {
    estado.filas = [cliente(1)]
    montar('/clientes?cliente=c1')
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar la ficha rápida' }))
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull())
    expect(screen.getByRole('link', { name: 'ZZ Cliente 1 SA' })).toBeInTheDocument()
  })

  it('el listado NO pide KPIs por fila: un N+1 con 1.010 clientes', async () => {
    estado.filas = [cliente(1), cliente(2), cliente(3)]
    montar()
    await screen.findByRole('link', { name: 'ZZ Cliente 1 SA' })
    expect(ficha360).not.toHaveBeenCalled()
  })

  it('en pantalla angosta la ficha es una hoja modal, no un panel al costado', async () => {
    estado.ancho = false
    estado.filas = [cliente(1)]
    montar('/clientes?cliente=c1')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).toBeNull()
  })
})

/**
 * Fase 19 · E7 — la fila entera, y el panel encima.
 *
 * Dos cambios que se prueban acá porque son del listado y no de la ficha:
 * que cualquier parte de la fila abra el panel —sin pisar a los controles que
 * viven adentro— y que abrirlo no toque la tabla.
 */
describe('La fila entera abre la ficha (Fase 19 · E7)', () => {
  const fila = (n: number) => screen.getByText(`CLI0000${n}`).closest('tr')!

  it('el click en una celda cualquiera abre la ficha, no sólo el del nombre', async () => {
    estado.filas = [cliente(1)]
    montar()
    // El CUIT: una celda de texto, sin ningún link adentro.
    fireEvent.click(screen.getByText('30-71234567-1'))
    expect(await screen.findByRole('complementary')).toBeInTheDocument()
    await waitFor(() => expect(ficha360).toHaveBeenCalledWith('c1', 12))
  })

  it('el click en el espacio vacío de la fila también', async () => {
    estado.filas = [cliente(1)]
    montar()
    fireEvent.click(fila(1))
    expect(await screen.findByRole('complementary')).toBeInTheDocument()
  })

  it('pero el checkbox de exportar NO abre nada: marca y punto', async () => {
    estado.filas = [cliente(1)]
    montar()
    const check = screen.getByRole('checkbox', { name: /Seleccionar ZZ Cliente 1 SA/ })
    fireEvent.click(check)
    expect(check).toBeChecked()
    await waitFor(() => expect(ficha360).not.toHaveBeenCalled())
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('con un modificador no se intercepta: Ctrl+click sobre la fila no abre el panel', () => {
    estado.filas = [cliente(1)]
    montar()
    fireEvent.click(fila(1), { ctrlKey: true })
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('con el teclado: la fila se enfoca y Enter o Espacio la abren', async () => {
    estado.filas = [cliente(1)]
    montar()
    expect(fila(1)).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(fila(1), { key: 'Enter' })
    expect(await screen.findByRole('complementary')).toBeInTheDocument()
  })

  it('Espacio sobre el checkbox enfocado es del checkbox, no de la fila', async () => {
    estado.filas = [cliente(1)]
    montar()
    const check = screen.getByRole('checkbox', { name: /Seleccionar ZZ Cliente 1 SA/ })
    fireEvent.keyDown(check, { key: ' ' })
    await waitFor(() => expect(ficha360).not.toHaveBeenCalled())
  })

  it('la fila abierta se marca a sí misma, para saber qué se está mirando', async () => {
    estado.filas = [cliente(1), cliente(2)]
    montar('/clientes?cliente=c2')
    await screen.findByRole('complementary')
    expect(fila(2)).toHaveAttribute('aria-current', 'true')
    expect(fila(1)).not.toHaveAttribute('aria-current')
  })

  /**
   * El panel se superpone: la tabla queda igual.
   *
   * En jsdom no hay layout —todo mide cero— así que lo que se puede afirmar
   * es lo que CAUSA el reacomodo: que el contenedor de la tabla no cambie de
   * clases al abrir el panel, y que el panel no sea hermano de la tabla
   * dentro de un flex. La medición real está en el informe de la entrega:
   * 1135 px con el panel cerrado y 1135 con el panel abierto, a 1440.
   */
  it('abrir el panel no le cambia una clase a la tabla', async () => {
    estado.filas = [cliente(1)]
    const { unmount } = montar()
    const antes = screen.getByRole('table').parentElement!.className
    unmount()

    montar('/clientes?cliente=c1')
    await screen.findByRole('complementary')
    expect(screen.getByRole('table').parentElement!.className).toBe(antes)
  })
})
