// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type * as ServicioCotizaciones from '../services/cotizaciones'
import type * as ServicioProductos from '../services/productosParaLinea'

/**
 * Alta de cotización (Fase 15 · E3).
 *
 * Se mockean los datos y la RPC de creación; el borrador, la validación, la
 * autoridad y los permisos son los de producción. Lo que importa probar:
 * **antes de «Crear cotización» no se escribe nada**, lo que se manda es lo
 * que se cargó, y salir con cambios pregunta.
 */
const estado = vi.hoisted((): {
  rol: string
  stel: Record<string, boolean>
  tarifas: { id: string; nombre: string; moneda: string }[]
  vendedores: { id: string; nombre: string }[]
  contactos: { id: string; nombre: string; rol: string | null }[]
  productos: unknown[]
  defaults: { vendedorId: string | null; tarifaId: string | null; formaPago: string | null; moneda: string | null } | null
} => ({
  rol: 'admin',
  stel: {},
  tarifas: [
    { id: 'lista-usd', nombre: 'Lista base', moneda: 'USD' },
    { id: 'mayorista', nombre: 'Mayorista', moneda: 'USD' },
    { id: 'lista-ars', nombre: 'Lista ARS', moneda: 'ARS' },
  ],
  vendedores: [{ id: 'u1', nombre: 'ZZ Vendedora' }],
  contactos: [{ id: 'k1', nombre: 'ZZ Contacto', rol: 'Compras' }],
  productos: [],
  defaults: null,
}))

const espias = vi.hoisted(() => ({
  crear: vi.fn(
    (
      _companyId: string,
      _cabecera: Record<string, string | number | null>,
      _lineas: Record<string, unknown>[],
    ) => Promise.resolve({ id: 'q-nueva', numero: 'COTI02630', total: 121, lineas: 1 }),
  ),
  buscar: vi.fn((_c: string, _t: string, _o?: { listaPrecioId?: string | null }) => Promise.resolve(estado.productos)),
  defaults: vi.fn((_c: string, _id: string) => Promise.resolve(estado.defaults)),
}))

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true, customerId: null } }),
}))
vi.mock('../hooks/useAutoridadNumeracion', () => ({
  useAutoridadNumeracion: () => ({ cargando: false, stel: (t: string) => estado.stel[t] === true }),
}))
vi.mock('../hooks/useDocumentos', () => ({
  useTarifas: () => ({ data: estado.tarifas, isPending: false }),
  useVendedores: () => ({ data: estado.vendedores, isPending: false }),
  useContactos: () => ({ data: estado.contactos, isPending: false }),
}))
vi.mock('../components/BuscadorCliente', () => ({
  BuscadorCliente: ({ onElegir }: { onElegir: (id: string | null) => void }) => (
    <button type="button" onClick={() => onElegir('cliente-1')}>
      elegir cliente
    </button>
  ),
}))
vi.mock('../services/clientes', async (real) => ({
  ...(await real<Record<string, unknown>>()),
  defaultsDeCliente: espias.defaults,
}))
vi.mock('../services/cotizaciones', async () => {
  const real = await vi.importActual<typeof ServicioCotizaciones>('../services/cotizaciones')
  return { ...real, crearCotizacion: espias.crear }
})
vi.mock('../services/productosParaLinea', async () => {
  const real = await vi.importActual<typeof ServicioProductos>('../services/productosParaLinea')
  return { ...real, buscarProductos: espias.buscar }
})

const { CotizacionNuevaPage } = await import('./CotizacionNuevaPage')

const montar = (extra?: React.ReactNode) => {
  const router = createMemoryRouter(
    [
      {
        path: '/ventas/cotizaciones/nueva',
        element: (
          <>
            {extra}
            <CotizacionNuevaPage />
          </>
        ),
      },
      { path: '/ventas/cotizaciones/:id', element: <p>detalle de la cotización</p> },
      { path: '/ventas/cotizaciones', element: <p>listado</p> },
    ],
    { initialEntries: ['/ventas/cotizaciones/nueva'] },
  )
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

/** Deja el alta en condiciones de guardar: cliente y moneda. */
const completarMinimo = () => {
  fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
  fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'USD' } })
}

beforeEach(() => {
  estado.rol = 'admin'
  estado.stel = {}
  estado.productos = []
  espias.crear.mockClear()
  espias.buscar.mockClear()
  espias.defaults.mockClear()
  estado.defaults = null
})

describe('Nueva cotización · borrador', () => {
  it('nace sin moneda y sin número, y no se puede crear hasta elegir cliente y moneda', () => {
    montar()
    expect(screen.getByRole('heading', { level: 1, name: 'Nueva cotización' })).toBeInTheDocument()
    expect(screen.getByLabelText('Moneda')).toHaveValue('')
    const crear = screen.getByRole('button', { name: 'Crear cotización' })
    expect(crear).toBeDisabled()
    expect(screen.getByText(/Elegí un cliente\./)).toBeInTheDocument()
    expect(screen.getByText(/Elegí la moneda del documento\./)).toBeInTheDocument()
    fireEvent.click(crear)
    expect(espias.crear).not.toHaveBeenCalled()
  })

  it('cargar la cotización entera NO escribe nada hasta apretar Crear', () => {
    montar()
    completarMinimo()
    fireEvent.click(screen.getByRole('button', { name: 'Nueva línea' }))
    fireEvent.change(screen.getAllByLabelText(/Cantidad/)[0]!, { target: { value: '3' } })
    expect(espias.crear).not.toHaveBeenCalled()
  })

  it('crea en UNA llamada, con lo cargado y sin campos de sistema, y abre el documento', async () => {
    montar()
    completarMinimo()
    fireEvent.change(screen.getByLabelText(/Tarifa/), { target: { value: 'mayorista' } })
    fireEvent.change(screen.getByLabelText(/Vendedor/), { target: { value: 'u1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Nueva línea' }))
    fireEvent.change(screen.getAllByLabelText(/Cantidad/)[0]!, { target: { value: '2' } })
    fireEvent.change(screen.getAllByLabelText(/Precio/)[0]!, { target: { value: '50' } })

    fireEvent.click(screen.getByRole('button', { name: 'Crear cotización' }))

    await waitFor(() => expect(espias.crear).toHaveBeenCalledTimes(1))
    const [empresa, cabecera, lineas] = espias.crear.mock.calls[0]!
    expect(empresa).toBe('c1')
    expect(cabecera).toMatchObject({
      customer_id: 'cliente-1',
      currency_code: 'USD',
      price_list_id: 'mayorista',
      salesperson_id: 'u1',
    })
    for (const prohibido of ['company_id', 'number', 'series_code', 'status', 'created_by', 'subtotal', 'total']) {
      expect(Object.keys(cabecera)).not.toContain(prohibido)
    }
    expect(lineas).toHaveLength(1)
    expect(lineas[0]).toMatchObject({ line_no: 1, quantity: 2, unit_price: 50 })
    expect(await screen.findByText('detalle de la cotización', undefined, { timeout: 8000 })).toBeInTheDocument()
  })

  it('un error del servidor se muestra en castellano y no navega', async () => {
    const { FalloDeGuardado } = await import('../services/cotizaciones')
    espias.crear.mockRejectedValueOnce(new FalloDeGuardado('CLIENTE_INVALIDO', 'El cliente no es de esta empresa.'))
    montar()
    completarMinimo()
    fireEvent.click(screen.getByRole('button', { name: 'Crear cotización' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('El cliente no es de esta empresa.')
    expect(screen.queryByText('detalle de la cotización')).not.toBeInTheDocument()
  })

  it('con la numeración en STEL no se puede crear, y se dice por qué', () => {
    estado.stel = { quote: true }
    montar()
    completarMinimo()
    expect(screen.getByRole('button', { name: 'Crear cotización' })).toBeDisabled()
    expect(screen.getAllByText(/STEL/).length).toBeGreaterThan(0)
  })

  it('quien no escribe no ve el formulario', () => {
    estado.rol = 'salesperson'
    montar()
    expect(screen.getByRole('heading', { level: 1, name: /no crea documentos de venta/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Crear cotización' })).not.toBeInTheDocument()
  })
})

describe('Nueva cotización · tarifa y precio sugerido', () => {
  it('el buscador recibe la tarifa del documento', async () => {
    montar()
    completarMinimo()
    fireEvent.change(screen.getByLabelText(/Tarifa/), { target: { value: 'mayorista' } })
    fireEvent.click(screen.getByRole('button', { name: 'Añadir producto' }))
    fireEvent.change(screen.getByLabelText(/Buscar por SKU/), { target: { value: 'balanceador' } })
    await waitFor(() => expect(espias.buscar).toHaveBeenCalled(), { timeout: 2000 })
    expect(espias.buscar.mock.calls.at(-1)![2]).toEqual({ listaPrecioId: 'mayorista' })
  })

  it('sólo se ofrecen tarifas de la moneda del documento', () => {
    montar()
    completarMinimo()
    const tarifa = screen.getByLabelText(/Tarifa/)
    const opciones = within(tarifa).getAllByRole('option').map((o) => o.textContent)
    expect(opciones).toContain('Mayorista')
    expect(opciones).not.toContain('Lista ARS')
  })
})

describe('Nueva cotización · salir con cambios', () => {
  it('con el borrador vacío se puede salir sin preguntar', async () => {
    montar(<Link to="/ventas/cotizaciones">volver</Link>)
    fireEvent.click(screen.getByRole('link', { name: 'volver' }))
    expect(await screen.findByText('listado')).toBeInTheDocument()
  })

  it('con datos cargados pregunta antes de perderlos', async () => {
    montar(<Link to="/ventas/cotizaciones">volver</Link>)
    completarMinimo()
    fireEvent.click(screen.getByRole('link', { name: 'volver' }))

    const dialogo = await screen.findByRole('alertdialog', { name: 'Hay cambios sin guardar' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Seguir editando' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Crear cotización' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'volver' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Descartar y salir' }))
    expect(await screen.findByText('listado')).toBeInTheDocument()
    expect(espias.crear).not.toHaveBeenCalled()
  })

  it('después de crear, navegar al documento no pregunta nada', async () => {
    montar()
    completarMinimo()
    fireEvent.click(screen.getByRole('button', { name: 'Crear cotización' }))
    expect(await screen.findByText('detalle de la cotización', undefined, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

/**
 * Los defaults del cliente en el alta (Fase 17 · E2).
 *
 * El cliente sugiere; la persona decide. Estas pruebas miran justamente el
 * borde: qué se completa solo, qué NO se pisa y qué se explica cuando un
 * default no se puede aplicar.
 */
describe('Nueva cotización · defaults del cliente', () => {
  it('al elegir el cliente completa vendedor, tarifa, forma de pago y moneda', async () => {
    estado.defaults = { vendedorId: 'u1', tarifaId: 'mayorista', formaPago: '60 días', moneda: 'USD' }
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))

    await waitFor(() => expect(screen.getByLabelText('Moneda')).toHaveValue('USD'))
    expect(screen.getByLabelText(/Vendedor/)).toHaveValue('u1')
    expect(screen.getByLabelText(/Tarifa/)).toHaveValue('mayorista')
    expect(screen.getByLabelText(/Forma de pago/)).toHaveValue('60 días')
    expect(espias.defaults).toHaveBeenCalledTimes(1)
  })

  it('un cliente sin defaults deja el formulario como estaba', async () => {
    estado.defaults = { vendedorId: null, tarifaId: null, formaPago: null, moneda: null }
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))

    await waitFor(() => expect(espias.defaults).toHaveBeenCalled())
    expect(screen.getByLabelText('Moneda')).toHaveValue('')
    expect(screen.getByLabelText(/Vendedor/)).toHaveValue('')
    expect(screen.getByLabelText(/Tarifa/)).toHaveValue('')
    expect(screen.queryByText(/Sobre los datos del cliente/)).toBeNull()
  })

  it('una tarifa del cliente en otra moneda no se aplica, y se dice por qué', async () => {
    estado.defaults = { vendedorId: null, tarifaId: 'lista-ars', formaPago: null, moneda: 'USD' }
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))

    expect(await screen.findByText(/está en ARS y el documento en USD/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Tarifa/)).toHaveValue('')
  })

  it('un vendedor que ya no está en la empresa no se aplica, y se avisa', async () => {
    estado.defaults = { vendedorId: 'se-fue', tarifaId: null, formaPago: null, moneda: 'USD' }
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))

    expect(await screen.findByText(/vendedor predeterminado del cliente ya no está disponible/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Vendedor/)).toHaveValue('')
  })

  it('lo que eligió la persona NO se pisa al elegir el cliente', async () => {
    estado.defaults = { vendedorId: 'u1', tarifaId: 'mayorista', formaPago: '60 días', moneda: 'USD' }
    montar()
    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'USD' } })
    fireEvent.change(screen.getByLabelText(/Tarifa/), { target: { value: 'lista-usd' } })
    fireEvent.change(screen.getByLabelText(/Forma de pago/), { target: { value: 'Contra entrega' } })

    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
    await waitFor(() => expect(espias.defaults).toHaveBeenCalled())

    expect(screen.getByLabelText(/Tarifa/)).toHaveValue('lista-usd')
    expect(screen.getByLabelText(/Forma de pago/)).toHaveValue('Contra entrega')
    // El vendedor no se tocó a mano: ése sí se sugiere.
    expect(screen.getByLabelText(/Vendedor/)).toHaveValue('u1')
  })

  it('la tarifa del cliente espera a la moneda y entra cuando se elige', async () => {
    estado.defaults = { vendedorId: null, tarifaId: 'mayorista', formaPago: null, moneda: null }
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
    await waitFor(() => expect(espias.defaults).toHaveBeenCalled())
    expect(screen.getByLabelText(/Tarifa/)).toHaveValue('')

    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'USD' } })
    expect(screen.getByLabelText(/Tarifa/)).toHaveValue('mayorista')
  })

  it('lo sugerido se guarda como cualquier otro valor: el documento lo congela', async () => {
    estado.defaults = { vendedorId: 'u1', tarifaId: 'mayorista', formaPago: '60 días', moneda: 'USD' }
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
    await waitFor(() => expect(screen.getByLabelText(/Tarifa/)).toHaveValue('mayorista'))

    fireEvent.click(screen.getByRole('button', { name: 'Crear cotización' }))
    await waitFor(() => expect(espias.crear).toHaveBeenCalledTimes(1))

    const [, cabecera] = espias.crear.mock.calls[0]!
    expect(cabecera).toMatchObject({
      customer_id: 'cliente-1',
      salesperson_id: 'u1',
      price_list_id: 'mayorista',
      payment_terms: '60 días',
      currency_code: 'USD',
    })
  })
})
