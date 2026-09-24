// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type * as ServicioCotizaciones from '../services/cotizaciones'
import type * as ServicioPedidos from '../services/pedidos'
import type * as ServicioProductos from '../services/productosParaLinea'

/**
 * Alta de pedido manual (Fase 15 · E4).
 *
 * La misma prueba que el alta de cotización, porque es la misma pantalla: el
 * borrador vive en memoria y **nada se escribe hasta apretar «Crear pedido»**.
 * Lo propio del pedido: no hay «Válida hasta», y la numeración bloqueada es la
 * de `sales_order`.
 */
const estado = vi.hoisted((): {
  rol: string
  stel: Record<string, boolean>
  tarifas: { id: string; nombre: string; moneda: string }[]
  vendedores: { id: string; nombre: string }[]
  contactos: { id: string; nombre: string; rol: string | null; esPrincipal: boolean; activo: boolean }[]
  direcciones: { id: string; texto: string; esPrincipal: boolean; activa: boolean }[]
  productos: unknown[]
  defaults: { vendedorId: string | null; tarifaId: string | null; formaPago: string | null; moneda: string | null } | null
  /** Fase 19 · E4: las series de pedido, con su autoridad efectiva. */
  series: { codigo: string; esPorDefecto: boolean; autoridad: string }[] | null
  /** Fase 26 · E2: con pantalla ancha la hoja del documento va al lado. */
  pantallaAncha: boolean
} => ({
  rol: 'admin',
  stel: {},
  series: null,
  tarifas: [
    { id: 'lista-usd', nombre: 'Lista base', moneda: 'USD' },
    { id: 'mayorista', nombre: 'Mayorista', moneda: 'USD' },
    { id: 'lista-ars', nombre: 'Lista ARS', moneda: 'ARS' },
  ],
  vendedores: [{ id: 'u1', nombre: 'ZZ Vendedora' }],
  contactos: [{ id: 'k1', nombre: 'ZZ Contacto', rol: 'Compras', esPrincipal: false, activo: true }],
  direcciones: [],
  productos: [],
  defaults: null,
  pantallaAncha: false,
}))

const espias = vi.hoisted(() => ({
  crear: vi.fn(
    (
      _companyId: string,
      _cabecera: Record<string, string | number | null>,
      _lineas: Record<string, unknown>[],
    ) => Promise.resolve({ id: 'pdv-nuevo', numero: 'PDV01330', total: 121, lineas: 1 }),
  ),
  buscar: vi.fn((_c: string, _t: string, _o?: { listaPrecioId?: string | null }) => Promise.resolve(estado.productos)),
  defaults: vi.fn((_c: string, _id: string) => Promise.resolve(estado.defaults)),
}))

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
// Los datos de la empresa para la hoja: no hay base en los tests.
vi.mock('../services/empresa', () => ({
  datosDeEmpresa: () => Promise.resolve({ nombre: 'ZZ Buscatools', razonSocial: null, cuit: null, direccion: null, telefono: null, email: null, web: null, color: '#1f2937' }),
}))
// La hoja al lado del editor depende del ancho (Fase 26 · E2).
vi.mock('@/hooks/useMediaQuery', () => ({
  useIsMobile: () => false,
  useMediaQuery: () => estado.pantallaAncha,
}))
vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true, customerId: null } }),
}))
vi.mock('../hooks/useAutoridadNumeracion', () => ({
  useAutoridadNumeracion: () => ({ cargando: false, stel: (t: string) => estado.stel[t] === true }),
}))
vi.mock('../hooks/useDocumentos', () => ({
  useTarifas: () => ({ data: estado.tarifas, isPending: false }),
  // Sin series propias se deriva de la autoridad general: es lo que pasa con
  // PDV, que no tiene fila de autoridad por serie.
  useSeries: () => ({
    data:
      estado.series ??
      [{ codigo: 'PDV', esPorDefecto: true, autoridad: estado.stel['sales_order'] ? 'STEL' : 'ERP' }],
    isPending: false,
  }),
  useVendedores: () => ({ data: estado.vendedores, isPending: false }),
  useContactos: () => ({ data: estado.contactos, isPending: false }),
  // La hoja necesita el NOMBRE del cliente (Fase 26 · E2).
  useNombreDeCliente: (id: string | null) =>
    ({ data: id === null ? undefined : { id, nombre: 'ZZ Cliente Uno' }, isPending: false }),
  // Fase 17 · E3: los domicilios de entrega del cliente.
  useDireccionesEntrega: () => ({ data: estado.direcciones, isPending: false }),
}))
vi.mock('../components/BuscadorCliente', () => ({
  BuscadorCliente: ({ onElegir }: { onElegir: (id: string | null) => void }) => (
    <>
      <button type="button" onClick={() => onElegir('cliente-1')}>
        elegir cliente
      </button>
      <button type="button" onClick={() => onElegir('cliente-2')}>
        otro cliente
      </button>
    </>
  ),
}))
vi.mock('../services/clientes', async (real) => ({
  ...(await real<Record<string, unknown>>()),
  defaultsDeCliente: espias.defaults,
}))
vi.mock('../services/pedidos', async () => {
  const real = await vi.importActual<typeof ServicioPedidos>('../services/pedidos')
  return { ...real, crearPedido: espias.crear }
})
vi.mock('../services/productosParaLinea', async () => {
  const real = await vi.importActual<typeof ServicioProductos>('../services/productosParaLinea')
  return { ...real, buscarProductos: espias.buscar }
})

const { PedidoNuevoPage } = await import('./PedidoNuevoPage')

const montar = (extra?: React.ReactNode) => {
  const router = createMemoryRouter(
    [
      {
        path: '/ventas/pedidos/nuevo',
        element: (
          <>
            {extra}
            <PedidoNuevoPage />
          </>
        ),
      },
      { path: '/ventas/pedidos/:id', element: <p>detalle del pedido</p> },
      { path: '/ventas/pedidos', element: <p>listado</p> },
    ],
    { initialEntries: ['/ventas/pedidos/nuevo'] },
  )
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

/** Deja el alta en condiciones de crear: cliente y moneda. */
const completarMinimo = () => {
  fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
  fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'USD' } })
}

beforeEach(() => {
  estado.rol = 'admin'
  estado.stel = {}
  estado.series = null
  estado.productos = []
  estado.pantallaAncha = false
  espias.crear.mockClear()
  espias.buscar.mockClear()
  espias.defaults.mockClear()
  estado.defaults = null
})

describe('Nuevo pedido · borrador', () => {
  it('nace sin moneda y sin número, y no se puede crear hasta elegir cliente y moneda', () => {
    montar()
    expect(screen.getByRole('heading', { level: 1, name: 'Nuevo pedido' })).toBeInTheDocument()
    expect(screen.getByLabelText('Moneda')).toHaveValue('')
    const crear = screen.getByRole('button', { name: 'Crear pedido' })
    expect(crear).toBeDisabled()
    expect(screen.getByText(/Elegí un cliente\./)).toBeInTheDocument()
    expect(screen.getByText(/Elegí la moneda del documento\./)).toBeInTheDocument()
    fireEvent.click(crear)
    expect(espias.crear).not.toHaveBeenCalled()
  })

  it('el pedido no tiene fecha de validez: el campo no existe', () => {
    montar()
    expect(screen.getByLabelText('Fecha')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Válida hasta/)).toBeNull()
  })

  it('cargar el pedido entero NO escribe nada hasta apretar Crear', () => {
    montar()
    completarMinimo()
    fireEvent.change(screen.getByLabelText(/Título/), { target: { value: 'ZZ pedido directo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Nueva línea' }))
    fireEvent.change(screen.getAllByLabelText(/Cantidad/)[0]!, { target: { value: '3' } })
    expect(espias.crear).not.toHaveBeenCalled()
  })

  it('crea en UNA llamada, con lo cargado y sin campos de sistema, y abre el pedido', async () => {
    montar()
    completarMinimo()
    fireEvent.change(screen.getByLabelText(/Tarifa/), { target: { value: 'mayorista' } })
    fireEvent.change(screen.getByLabelText(/Vendedor/), { target: { value: 'u1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Nueva línea' }))
    fireEvent.change(screen.getAllByLabelText(/Cantidad/)[0]!, { target: { value: '2' } })
    fireEvent.change(screen.getAllByLabelText(/Precio/)[0]!, { target: { value: '50' } })

    fireEvent.click(screen.getByRole('button', { name: 'Crear pedido' }))

    await waitFor(() => expect(espias.crear).toHaveBeenCalledTimes(1))
    const [empresa, cabecera, lineas] = espias.crear.mock.calls[0]!
    expect(empresa).toBe('c1')
    expect(cabecera).toMatchObject({
      customer_id: 'cliente-1',
      currency_code: 'USD',
      price_list_id: 'mayorista',
      salesperson_id: 'u1',
    })
    // La fecha del pedido es `order_date`, no `quote_date`.
    expect(Object.keys(cabecera)).toContain('order_date')
    for (const prohibido of [
      'company_id', 'number', 'series_code', 'status', 'commercial_status',
      'created_by', 'quote_id', 'source', 'subtotal', 'total', 'valid_until',
    ]) {
      expect(Object.keys(cabecera)).not.toContain(prohibido)
    }
    expect(lineas).toHaveLength(1)
    expect(lineas[0]).toMatchObject({ line_no: 1, quantity: 2, unit_price: 50 })
    expect(await screen.findByText('detalle del pedido', undefined, { timeout: 8000 })).toBeInTheDocument()
  })

  it('un error del servidor se muestra en castellano y no navega', async () => {
    const { FalloDeGuardado } = await vi.importActual<typeof ServicioCotizaciones>('../services/cotizaciones')
    espias.crear.mockRejectedValueOnce(new FalloDeGuardado('CLIENTE_INVALIDO', 'El cliente no es de esta empresa.'))
    montar()
    completarMinimo()
    fireEvent.click(screen.getByRole('button', { name: 'Crear pedido' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('El cliente no es de esta empresa.')
    expect(screen.queryByText('detalle del pedido')).not.toBeInTheDocument()
  })

  it('con la numeración de pedidos en STEL no se puede crear, y se dice por qué', () => {
    estado.stel = { sales_order: true }
    montar()
    completarMinimo()
    expect(screen.getByRole('button', { name: 'Crear pedido' })).toBeDisabled()
    expect(screen.getAllByText(/STEL/).length).toBeGreaterThan(0)
  })

  /**
   * Fase 19 · E4 · el selector de serie, igual que en la cotización.
   *
   * En Buscatools son PDV —por defecto, que numera STEL— y PDV-ERP. A la
   * segunda se llega eligiéndola: nunca se seleziona sola.
   */
  describe('la serie del pedido', () => {
    const DOS = [
      { codigo: 'PDV', esPorDefecto: true, autoridad: 'STEL' },
      { codigo: 'PDV-ERP', esPorDefecto: false, autoridad: 'ERP' },
    ]

    it('con una sola serie no aparece: no hay nada que elegir', () => {
      estado.series = [{ codigo: 'PDV', esPorDefecto: true, autoridad: 'ERP' }]
      montar()
      expect(screen.queryByLabelText('Serie')).toBeNull()
    })

    it('con dos, arranca SIEMPRE en la que está por defecto, y esa bloquea', () => {
      estado.series = DOS
      montar()
      completarMinimo()
      expect(screen.getByLabelText('Serie')).toHaveValue('PDV')
      expect(screen.getByRole('button', { name: 'Crear pedido' })).toBeDisabled()
      expect(screen.getAllByText(/la serie PDV la numera STEL/i).length).toBeGreaterThan(0)
    })

    it('eligiendo la serie del ERP se habilita, y volver a la otra vuelve a bloquear', () => {
      estado.series = DOS
      montar()
      completarMinimo()
      fireEvent.change(screen.getByLabelText('Serie'), { target: { value: 'PDV-ERP' } })
      expect(screen.getByRole('button', { name: 'Crear pedido' })).toBeEnabled()

      fireEvent.change(screen.getByLabelText('Serie'), { target: { value: 'PDV' } })
      expect(screen.getByRole('button', { name: 'Crear pedido' })).toBeDisabled()
    })

    it('la serie elegida viaja en el payload; sin elegir, no viaja nada', async () => {
      estado.series = [
        { codigo: 'PDV', esPorDefecto: true, autoridad: 'ERP' },
        { codigo: 'PDV-ERP', esPorDefecto: false, autoridad: 'ERP' },
      ]
      const { unmount } = montar()
      completarMinimo()
      fireEvent.click(screen.getByRole('button', { name: 'Crear pedido' }))
      await waitFor(() => expect(espias.crear).toHaveBeenCalledTimes(1))
      expect(Object.keys(espias.crear.mock.calls[0]![1])).not.toContain('series_code')
      unmount()
      espias.crear.mockClear()

      montar()
      completarMinimo()
      fireEvent.change(screen.getByLabelText('Serie'), { target: { value: 'PDV-ERP' } })
      fireEvent.click(screen.getByRole('button', { name: 'Crear pedido' }))
      await waitFor(() => expect(espias.crear).toHaveBeenCalledTimes(1))
      expect(espias.crear.mock.calls[0]![1]).toMatchObject({ series_code: 'PDV-ERP' })
    })
  })

  it('quien no escribe no ve el formulario', () => {
    estado.rol = 'salesperson'
    montar()
    expect(screen.getByRole('heading', { level: 1, name: /no crea documentos de venta/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Crear pedido' })).not.toBeInTheDocument()
  })
})

describe('Nuevo pedido · tarifa y precio sugerido', () => {
  it('el buscador de productos recibe la tarifa del pedido', async () => {
    montar()
    completarMinimo()
    fireEvent.change(screen.getByLabelText(/Tarifa/), { target: { value: 'mayorista' } })
    fireEvent.click(screen.getByRole('button', { name: 'Añadir producto' }))
    fireEvent.change(screen.getByLabelText(/Buscar por SKU/), { target: { value: 'balanceador' } })
    await waitFor(() => expect(espias.buscar).toHaveBeenCalled(), { timeout: 2000 })
    expect(espias.buscar.mock.calls.at(-1)![2]).toEqual({ listaPrecioId: 'mayorista' })
  })

  it('sólo se ofrecen tarifas de la moneda del pedido', () => {
    montar()
    completarMinimo()
    const tarifa = screen.getByLabelText(/Tarifa/)
    const opciones = within(tarifa).getAllByRole('option').map((o) => o.textContent)
    expect(opciones).toContain('Mayorista')
    expect(opciones).not.toContain('Lista ARS')
  })
})

describe('Nuevo pedido · salir con cambios', () => {
  it('con el borrador vacío se puede salir sin preguntar', async () => {
    montar(<Link to="/ventas/pedidos">volver</Link>)
    fireEvent.click(screen.getByRole('link', { name: 'volver' }))
    expect(await screen.findByText('listado')).toBeInTheDocument()
  })

  it('con datos cargados pregunta antes de perderlos', async () => {
    montar(<Link to="/ventas/pedidos">volver</Link>)
    completarMinimo()
    fireEvent.click(screen.getByRole('link', { name: 'volver' }))

    const dialogo = await screen.findByRole('alertdialog', { name: 'Hay cambios sin guardar' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Seguir editando' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Crear pedido' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'volver' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Descartar y salir' }))
    expect(await screen.findByText('listado')).toBeInTheDocument()
    expect(espias.crear).not.toHaveBeenCalled()
  })

  it('después de crear, navegar al pedido no pregunta nada', async () => {
    montar()
    completarMinimo()
    fireEvent.click(screen.getByRole('button', { name: 'Crear pedido' }))
    expect(await screen.findByText('detalle del pedido', undefined, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

/**
 * Los defaults del cliente en el alta del pedido (Fase 17 · E2).
 *
 * El pedido manual se comporta igual que la cotización. El pedido que nace de
 * una cotización NO pasa por acá: conserva el snapshot aprobado, y eso lo
 * prueba la suite de la conversión.
 */
describe('Nuevo pedido · defaults del cliente', () => {
  it('al elegir el cliente completa vendedor, tarifa, forma de pago y moneda', async () => {
    estado.defaults = { vendedorId: 'u1', tarifaId: 'mayorista', formaPago: '60 días', moneda: 'USD' }
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))

    await waitFor(() => expect(screen.getByLabelText('Moneda')).toHaveValue('USD'))
    expect(screen.getByLabelText(/Vendedor/)).toHaveValue('u1')
    expect(screen.getByLabelText(/Tarifa/)).toHaveValue('mayorista')
    expect(screen.getByLabelText(/Forma de pago/)).toHaveValue('60 días')
  })

  it('y lo sugerido queda congelado en el pedido al crearlo', async () => {
    estado.defaults = { vendedorId: 'u1', tarifaId: 'mayorista', formaPago: '60 días', moneda: 'USD' }
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
    // Sin margen extra: el timeout de 8 s que había acá tapaba la carrera de
    // `aplicarDefaults`, que la Fase 19 · E1 corrigió. Si vuelve, esto falla.
    await waitFor(() => expect(screen.getByLabelText(/Tarifa/)).toHaveValue('mayorista'))

    fireEvent.click(screen.getByRole('button', { name: 'Crear pedido' }))
    await waitFor(() => expect(espias.crear).toHaveBeenCalledTimes(1))
    const [, cabecera] = espias.crear.mock.calls[0]!
    expect(cabecera).toMatchObject({
      salesperson_id: 'u1',
      price_list_id: 'mayorista',
      payment_terms: '60 días',
      currency_code: 'USD',
    })
  })

  it('un cliente sin defaults no rompe nada', async () => {
    estado.defaults = { vendedorId: null, tarifaId: null, formaPago: null, moneda: null }
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
    await waitFor(() => expect(espias.defaults).toHaveBeenCalled())
    expect(screen.getByLabelText('Moneda')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Crear pedido' })).toBeDisabled()
  })
})

/**
 * Fase 17 · E3: el contacto principal y el domicilio de entrega.
 *
 * El domicilio es el dato que decide **a dónde va la mercadería**, así que las
 * pruebas miran lo que viaja en `crear_pedido`, no lo que se ve en pantalla.
 */
describe('Nuevo pedido · contacto y domicilio de entrega (Fase 17 · E3)', () => {
  it('al elegir el cliente entra su contacto principal y su domicilio principal', async () => {
    estado.contactos = [
      { id: 'k1', nombre: 'ZZ Ana', rol: 'Compras', esPrincipal: true, activo: true },
      { id: 'k2', nombre: 'ZZ Beto', rol: null, esPrincipal: false, activo: true },
    ]
    estado.direcciones = [
      { id: 'd1', texto: 'Av. Siempreviva 742', esPrincipal: true, activa: true },
      { id: 'd2', texto: 'Otra 1', esPrincipal: false, activa: true },
    ]
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))

    await waitFor(() => expect(screen.getByLabelText(/Contacto/)).toHaveValue('k1'))
    expect(screen.getByLabelText(/Entregar en/)).toHaveValue('d1')
  })

  it('el domicilio elegido viaja en la creación, y sin elegir va en null', async () => {
    estado.direcciones = [
      { id: 'd1', texto: 'Av. Siempreviva 742', esPrincipal: true, activa: true },
      { id: 'd2', texto: 'Depósito Norte', esPrincipal: false, activa: true },
    ]
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
    await waitFor(() => expect(screen.getByLabelText(/Entregar en/)).toHaveValue('d1'))

    // La persona elige otro domicilio: eso es lo que tiene que viajar.
    fireEvent.change(screen.getByLabelText(/Entregar en/), { target: { value: 'd2' } })
    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'USD' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear pedido' }))

    await waitFor(() => expect(espias.crear).toHaveBeenCalledTimes(1))
    expect(espias.crear.mock.calls[0]![1]).toMatchObject({ shipping_address_id: 'd2' })
  })

  it('«domicilio principal del cliente» es una elección válida: viaja en null', async () => {
    estado.direcciones = [{ id: 'd1', texto: 'Av. Siempreviva 742', esPrincipal: true, activa: true }]
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
    await waitFor(() => expect(screen.getByLabelText(/Entregar en/)).toHaveValue('d1'))

    fireEvent.change(screen.getByLabelText(/Entregar en/), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'USD' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear pedido' }))

    await waitFor(() => expect(espias.crear).toHaveBeenCalledTimes(1))
    expect(espias.crear.mock.calls[0]![1]).toMatchObject({ shipping_address_id: null })
  })

  it('lo que la persona eligió NO se pisa cuando llega la lista', async () => {
    estado.contactos = [{ id: 'k1', nombre: 'ZZ Ana', rol: null, esPrincipal: true, activo: true }]
    estado.direcciones = [
      { id: 'd1', texto: 'Principal', esPrincipal: true, activa: true },
      { id: 'd2', texto: 'Depósito', esPrincipal: false, activa: true },
    ]
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
    await waitFor(() => expect(screen.getByLabelText(/Entregar en/)).toHaveValue('d1'))

    fireEvent.change(screen.getByLabelText(/Entregar en/), { target: { value: 'd2' } })
    fireEvent.change(screen.getByLabelText(/Contacto/), { target: { value: '' } })
    // Un re-render no vuelve a sugerir: la sugerencia sólo llena lo vacío y no
    // tocado, y estos dos campos ya son una decisión.
    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'USD' } })
    expect(screen.getByLabelText(/Entregar en/)).toHaveValue('d2')
    expect(screen.getByLabelText(/Contacto/)).toHaveValue('')
  })

  it('un principal desactivado no se sugiere ni se ofrece para elegir', async () => {
    estado.contactos = [{ id: 'k1', nombre: 'ZZ Ana', rol: null, esPrincipal: true, activo: false }]
    estado.direcciones = [{ id: 'd1', texto: 'Vieja', esPrincipal: true, activa: false }]
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
    await waitFor(() => expect(espias.defaults).toHaveBeenCalled())

    expect(screen.getByLabelText(/Contacto/)).toHaveValue('')
    expect(screen.getByLabelText(/Entregar en/)).toHaveValue('')
    // Y no están entre las opciones: en un documento nuevo no se ofrecen.
    expect(screen.queryByRole('option', { name: /ZZ Ana/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Vieja/ })).not.toBeInTheDocument()
  })

  it('cambiar de cliente se lleva el domicilio del anterior', async () => {
    estado.direcciones = [{ id: 'd1', texto: 'Del primero', esPrincipal: true, activa: true }]
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
    await waitFor(() => expect(screen.getByLabelText(/Entregar en/)).toHaveValue('d1'))

    estado.direcciones = []
    fireEvent.click(screen.getByRole('button', { name: 'otro cliente' }))
    await waitFor(() => expect(screen.getByLabelText(/Entregar en/)).toHaveValue(''))
  })
})

/**
 * Fase 19 · E1 — la misma carrera que «Nueva cotización», en su gemela.
 *
 * `respuestaInmediata` lleva al extremo, de forma determinista, la ventana en
 * la que una promesa ya resuelta gana contra un efecto pasivo: React agenda
 * los efectos, no los corre en el acto. Con la implementación vieja los
 * defaults se calculaban sobre el borrador ANTERIOR al click y lo que se
 * perdía era el cliente recién elegido.
 */
const respuestaInmediata = <T,>(valor: T): Promise<T> =>
  ({
    then(cb?: (v: T) => unknown) {
      cb?.(valor)
      return respuestaInmediata(valor)
    },
    catch() {
      return respuestaInmediata(valor)
    },
    finally() {
      return respuestaInmediata(valor)
    },
  }) as unknown as Promise<T>

describe('Nuevo pedido · defaults que llegan antes de que React confirme', () => {
  it('el cliente elegido NO se pierde cuando la respuesta gana la carrera', () => {
    estado.defaults = { vendedorId: 'u1', tarifaId: 'mayorista', formaPago: '60 días', moneda: 'USD' }
    espias.defaults.mockImplementationOnce(() => respuestaInmediata(estado.defaults))
    montar()

    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))

    expect(screen.getByRole('button', { name: 'Crear pedido' })).toBeEnabled()
    expect(screen.getByLabelText('Moneda')).toHaveValue('USD')
    expect(screen.getByLabelText(/Tarifa/)).toHaveValue('mayorista')
  })

  it('lo que se manda al servidor lleva cliente Y defaults', async () => {
    estado.defaults = { vendedorId: 'u1', tarifaId: 'mayorista', formaPago: '60 días', moneda: 'USD' }
    espias.defaults.mockImplementationOnce(() => respuestaInmediata(estado.defaults))
    montar()

    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear pedido' }))
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

/**
 * La hoja al lado del editor (Fase 26 · E2).
 *
 * El alta de cotización la tenía desde la Fase 19 · E3 y el alta de pedido no,
 * aunque el pedido es el documento que más se carga. «Que todas se vean igual»
 * incluye las altas.
 */
describe('La hoja del pedido nuevo', () => {
  const hoja = () => screen.queryByRole('region', { name: 'Documento' })

  it('con pantalla ancha aparece sola y es el editor', async () => {
    estado.pantallaAncha = true
    montar()
    await waitFor(() => expect(hoja()).not.toBeNull())
    expect(within(hoja()!).getByRole('button', { name: /Agregar producto/ })).toBeInTheDocument()
  })

  it('sin cliente elegido la hoja lo dice, en vez de quedar en blanco', async () => {
    estado.pantallaAncha = true
    montar()
    await waitFor(() => expect(hoja()).not.toBeNull())
    expect(within(hoja()!).getByText('(cliente sin elegir)')).toBeInTheDocument()
  })

  it('con pantalla angosta hay un botón para verla', async () => {
    estado.pantallaAncha = false
    montar()
    expect(hoja()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Vista previa' }))
    await waitFor(() => expect(hoja()).not.toBeNull())
  })
})
