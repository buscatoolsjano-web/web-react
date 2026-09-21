// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  pantallaAncha: boolean
  series: { codigo: string; esPorDefecto: boolean; autoridad: 'ERP' | 'STEL' }[]
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
  pantallaAncha: false,
  series: [],
  defaults: null,
}))

/**
 * Lo que se ve en pantalla en el instante en que se dispara el alta.
 *
 * Fase 19 · E3: si alguna vez lo que se manda no coincide con lo que la
 * persona está viendo, el fallo tiene que decir LAS DOS COSAS. Sin esto el
 * mensaje era «esperaba mayorista, recibí null» y no se sabía si el problema
 * era aplicar los defaults o leer el borrador.
 */
let pantallaAlCrear: Record<string, string> | null = null

const leerPantalla = (): Record<string, string> => {
  const valor = (re: RegExp | string) => {
    const el = screen.queryByLabelText(re)
    return el instanceof HTMLSelectElement || el instanceof HTMLInputElement ? el.value : '(no está)'
  }
  return {
    moneda: valor('Moneda'),
    vendedor: valor(/Vendedor/),
    tarifa: valor(/Tarifa/),
    formaPago: valor(/Forma de pago/),
  }
}

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
// La vista previa al lado del editor depende del ancho (Fase 19 · E3).
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
  useVendedores: () => ({ data: estado.vendedores, isPending: false }),
  useContactos: () => ({ data: estado.contactos, isPending: false }),
  useSeries: () => ({ data: estado.series, isPending: false }),
  useNombreDeCliente: (id: string | null) =>
    ({ data: id === null ? undefined : { id, nombre: 'ZZ Cliente Uno' }, isPending: false }),
}))
vi.mock('../components/BuscadorCliente', () => ({
  BuscadorCliente: ({ onElegir }: { onElegir: (id: string | null) => void }) => (
    <>
      <button type="button" onClick={() => onElegir('cliente-1')}>
        elegir cliente
      </button>
      {/* Un segundo cliente, para probar el cambio rápido y la respuesta que
          llega tarde (Fase 19 · E1). */}
      <button type="button" onClick={() => onElegir('cliente-2')}>
        elegir otro cliente
      </button>
    </>
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

const montar = (extra?: React.ReactNode, entrada = '/ventas/cotizaciones/nueva') => {
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
    { initialEntries: [entrada] },
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
  estado.pantallaAncha = false
  estado.series = []
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
    // Se espera el EFECTO —el vendedor sugerido— y no la llamada al servicio:
    // desde la Fase 19 · E1 los defaults se aplican en un efecto, un commit
    // después de que llega la respuesta. El vendedor no se tocó a mano, así
    // que ése sí se sugiere.
    await waitFor(() => expect(screen.getByLabelText(/Vendedor/)).toHaveValue('u1'))

    expect(screen.getByLabelText(/Tarifa/)).toHaveValue('lista-usd')
    expect(screen.getByLabelText(/Forma de pago/)).toHaveValue('Contra entrega')
  })

  it('la tarifa del cliente espera a la moneda y entra cuando se elige', async () => {
    estado.defaults = { vendedorId: null, tarifaId: 'mayorista', formaPago: null, moneda: null }
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
    // Acá no hay nada que esperar: con la moneda sin definir, el default de
    // tarifa NO entra. Se drenan los efectos y recién después se afirma, que
    // es la única forma honesta de comprobar que algo no pasó.
    await act(async () => {})
    expect(screen.getByLabelText(/Tarifa/)).toHaveValue('')

    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'USD' } })
    expect(screen.getByLabelText(/Tarifa/)).toHaveValue('mayorista')
  })

  it('lo sugerido se guarda como cualquier otro valor: el documento lo congela', async () => {
    estado.defaults = { vendedorId: 'u1', tarifaId: 'mayorista', formaPago: '60 días', moneda: 'USD' }
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
    // Sin margen extra: el timeout de 8 s que había acá tapaba la carrera de
    // `aplicarDefaults`, que la Fase 19 · E1 corrigió. Si vuelve, esto falla.
    await waitFor(() => expect(screen.getByLabelText(/Tarifa/)).toHaveValue('mayorista'))
    // Los cuatro en pantalla ANTES de crear: si lo que se manda no coincide
    // con esto, el problema no es la aplicación de los defaults sino lo que
    // el alta lee del borrador.
    expect(screen.getByLabelText('Moneda')).toHaveValue('USD')
    expect(screen.getByLabelText(/Vendedor/)).toHaveValue('u1')
    expect(screen.getByLabelText(/Forma de pago/)).toHaveValue('60 días')

    espias.crear.mockImplementationOnce((_c, cab, _l) => {
      pantallaAlCrear = leerPantalla()
      void cab
      return Promise.resolve({ id: 'q-nueva', numero: 'COTI02630', total: 121, lineas: 1 })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cotización' }))
    await waitFor(() => expect(espias.crear).toHaveBeenCalledTimes(1))

    const [, cabecera] = espias.crear.mock.calls[0]!
    // Las dos mitades en la MISMA aserción: si divergen, el mensaje del fallo
    // muestra qué se veía y qué se mandó.
    expect({ pantalla: pantallaAlCrear, cabecera }).toMatchObject({
      pantalla: { moneda: 'USD', vendedor: 'u1', tarifa: 'mayorista', formaPago: '60 días' },
      cabecera: {
        customer_id: 'cliente-1',
        salesperson_id: 'u1',
        price_list_id: 'mayorista',
        payment_terms: '60 días',
        currency_code: 'USD',
      },
    })
  })
})

/**
 * Fase 19 · E1 — la carrera de los defaults, en serio.
 *
 * El commit `944d1e2` le subió el timeout a `waitFor` y concluyó «no es un bug
 * del código: la respuesta llega tarde bajo carga». Era al revés: la respuesta
 * llega **temprano**, antes de que React confirme el cambio de cliente, y los
 * defaults se calculaban sobre un borrador viejo que después pisaba al bueno.
 *
 * `respuestaInmediata` es ese caso llevado al extremo: un thenable que ejecuta
 * su callback en el acto, dentro del mismo manejador del click. No simula una
 * red imposible; simula —de forma determinista— la ventana real en la que una
 * promesa ya resuelta gana la carrera contra un efecto pasivo, que React
 * agenda y no corre en el momento. Con la implementación vieja esto falla
 * siempre; con `waitFor` fallaba una de cada seis veces y parecía lentitud.
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

describe('Nueva cotización · defaults que llegan antes de que React confirme', () => {
  it('el cliente elegido NO se pierde cuando la respuesta gana la carrera', () => {
    estado.defaults = { vendedorId: 'u1', tarifaId: 'mayorista', formaPago: '60 días', moneda: 'USD' }
    espias.defaults.mockImplementationOnce(() => respuestaInmediata(estado.defaults))
    montar()

    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))

    // Si los defaults se aplicaron sobre el borrador previo al click, el
    // cliente desaparece y «Crear cotización» queda deshabilitado por falta
    // de cliente. Ése era el bug.
    expect(screen.getByRole('button', { name: 'Crear cotización' })).toBeEnabled()
  })

  it('y los defaults igual se aplican sobre el borrador que quedó', () => {
    estado.defaults = { vendedorId: 'u1', tarifaId: 'mayorista', formaPago: '60 días', moneda: 'USD' }
    espias.defaults.mockImplementationOnce(() => respuestaInmediata(estado.defaults))
    montar()

    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))

    expect(screen.getByLabelText('Moneda')).toHaveValue('USD')
    expect(screen.getByLabelText(/Tarifa/)).toHaveValue('mayorista')
    expect(screen.getByLabelText(/Vendedor/)).toHaveValue('u1')
  })

  it('lo que se manda al servidor lleva cliente Y defaults', async () => {
    estado.defaults = { vendedorId: 'u1', tarifaId: 'mayorista', formaPago: '60 días', moneda: 'USD' }
    espias.defaults.mockImplementationOnce(() => respuestaInmediata(estado.defaults))
    montar()

    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
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

describe('Nueva cotización · cambio de cliente rápido', () => {
  /** Una promesa que se resuelve cuando el test quiere. */
  const diferida = <T,>() => {
    let resolver!: (v: T) => void
    const promesa = new Promise<T>((r) => {
      resolver = r
    })
    return { promesa, resolver }
  }

  it('la respuesta del cliente que se descartó NO pisa al que quedó elegido', async () => {
    const primera = diferida<typeof estado.defaults>()
    const segunda = diferida<typeof estado.defaults>()
    espias.defaults
      .mockImplementationOnce(() => primera.promesa)
      .mockImplementationOnce(() => segunda.promesa)
    montar()

    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
    fireEvent.click(screen.getByRole('button', { name: 'elegir otro cliente' }))

    // Llega la del SEGUNDO y después, tarde, la del primero.
    await act(async () => {
      segunda.resolver({ vendedorId: 'u1', tarifaId: 'mayorista', formaPago: '60 días', moneda: 'USD' })
      await segunda.promesa
    })
    await act(async () => {
      primera.resolver({ vendedorId: null, tarifaId: 'lista-ars', formaPago: 'Contra entrega', moneda: 'ARS' })
      await primera.promesa
    })

    // Gana el último cliente elegido, no la última respuesta en llegar.
    expect(screen.getByLabelText('Moneda')).toHaveValue('USD')
    expect(screen.getByLabelText(/Tarifa/)).toHaveValue('mayorista')
    expect(screen.getByLabelText(/Forma de pago/)).toHaveValue('60 días')

    fireEvent.click(screen.getByRole('button', { name: 'Crear cotización' }))
    await waitFor(() => expect(espias.crear).toHaveBeenCalledTimes(1))
    expect(espias.crear.mock.calls[0]![1]).toMatchObject({ customer_id: 'cliente-2' })
  })

  it('una respuesta que tarda igual se aplica sobre lo que la persona escribió mientras tanto', async () => {
    const tarde = diferida<typeof estado.defaults>()
    espias.defaults.mockImplementationOnce(() => tarde.promesa)
    montar()

    fireEvent.click(screen.getByRole('button', { name: 'elegir cliente' }))
    // Mientras los defaults viajan, la persona elige la tarifa a mano.
    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'USD' } })
    fireEvent.change(screen.getByLabelText(/Tarifa/), { target: { value: 'lista-usd' } })

    await act(async () => {
      tarde.resolver({ vendedorId: 'u1', tarifaId: 'mayorista', formaPago: '60 días', moneda: 'USD' })
      await tarde.promesa
    })

    // Lo elegido a mano manda; lo que nadie tocó, se sugiere.
    expect(screen.getByLabelText(/Tarifa/)).toHaveValue('lista-usd')
    expect(screen.getByLabelText(/Vendedor/)).toHaveValue('u1')
    expect(screen.getByLabelText(/Forma de pago/)).toHaveValue('60 días')
  })
})

describe('Nueva cotización · vista previa del borrador', () => {
  it('no se muestra sola en pantalla angosta: se ofrece un botón', () => {
    montar()
    expect(screen.queryByRole('region', { name: 'Vista previa del documento' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Vista previa' })).toBeInTheDocument()
  })

  it('el botón la abre y la cierra, sin guardar nada', () => {
    montar()
    completarMinimo()
    fireEvent.click(screen.getByRole('button', { name: 'Vista previa' }))

    expect(screen.getByRole('region', { name: 'Vista previa del documento' })).toBeInTheDocument()
    // Lo que importa de una previsualización: que no escriba.
    expect(espias.crear).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar vista previa' }))
    expect(screen.queryByRole('region', { name: 'Vista previa del documento' })).toBeNull()
  })

  it('en pantalla ancha va al lado del editor y no hay botón que apretar', () => {
    estado.pantallaAncha = true
    montar()
    expect(screen.getByRole('region', { name: 'Vista previa del documento' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Vista previa' })).toBeNull()
  })

  it('muestra el borrador: cliente por nombre, líneas y moneda', () => {
    estado.pantallaAncha = true
    montar()
    completarMinimo()
    fireEvent.click(screen.getByRole('button', { name: 'Nueva línea' }))
    fireEvent.change(screen.getAllByLabelText(/Cantidad/)[0]!, { target: { value: '3' } })
    fireEvent.change(screen.getAllByLabelText(/Precio/)[0]!, { target: { value: '100' } })

    const previa = screen.getByRole('region', { name: 'Vista previa del documento' })
    // El id no: el documento se imprime con el NOMBRE del cliente.
    expect(within(previa).getByText(/ZZ Cliente Uno/)).toBeInTheDocument()
    expect(within(previa).queryByText('cliente-1')).toBeNull()
    expect(within(previa).getAllByText(/USD/).length).toBeGreaterThan(0)
  })

  /**
   * Lo que la previa NO puede saber tiene que decirlo, no inventarlo: el
   * número y el total definitivo los pone el servidor al crear.
   */
  it('no inventa el número ni el total definitivo', () => {
    estado.pantallaAncha = true
    montar()
    completarMinimo()
    const previa = screen.getByRole('region', { name: 'Vista previa del documento' })
    expect(within(previa).getByText(/a asignar al crear/)).toBeInTheDocument()
    expect(within(previa).getByText(/El número y el total definitivo los pone el servidor/)).toBeInTheDocument()
  })
})

describe('Nueva cotización · selector de serie (Fase 19 · E3)', () => {
  const DOS = [
    { codigo: 'COTI', esPorDefecto: true, autoridad: 'STEL' as const },
    { codigo: 'COT-ERP', esPorDefecto: false, autoridad: 'ERP' as const },
  ]

  it('con una sola serie no aparece: no hay nada que elegir', () => {
    estado.series = [{ codigo: 'COTI', esPorDefecto: true, autoridad: 'ERP' }]
    montar()
    expect(screen.queryByLabelText('Serie')).toBeNull()
  })

  it('con dos, arranca SIEMPRE en la que está por defecto', () => {
    estado.series = DOS
    montar()
    expect(screen.getByLabelText('Serie')).toHaveValue('COTI')
  })

  /** Lo que bloquea es la autoridad de la serie elegida, no la general. */
  it('la serie por defecto es STEL: no se puede crear y se dice por qué', () => {
    estado.series = DOS
    montar()
    completarMinimo()
    expect(screen.getByRole('button', { name: 'Crear cotización' })).toBeDisabled()
    // Aparece dos veces —el cartel de arriba y la nota del botón—, que es
    // como venía de la Fase 12.
    expect(screen.getAllByText(/Emisión desde el ERP bloqueada/).length).toBeGreaterThan(0)
  })

  it('eligiendo la serie ERP se habilita, y recién ahí', () => {
    estado.series = DOS
    montar()
    completarMinimo()
    expect(screen.getByRole('button', { name: 'Crear cotización' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Serie'), { target: { value: 'COT-ERP' } })
    expect(screen.getByRole('button', { name: 'Crear cotización' })).toBeEnabled()
    expect(screen.queryByText(/Emisión desde el ERP bloqueada/)).toBeNull()
  })

  it('sin elegir nada, el payload NO lleva serie: el servidor resuelve la de siempre', async () => {
    estado.series = DOS
    // La serie por defecto es ERP en este caso, para poder llegar a crear.
    estado.series = [
      { codigo: 'COTI', esPorDefecto: true, autoridad: 'ERP' },
      { codigo: 'COT-ERP', esPorDefecto: false, autoridad: 'ERP' },
    ]
    montar()
    completarMinimo()
    fireEvent.click(screen.getByRole('button', { name: 'Crear cotización' }))
    await waitFor(() => expect(espias.crear).toHaveBeenCalledTimes(1))

    const [, cabecera] = espias.crear.mock.calls[0]!
    expect(Object.keys(cabecera)).not.toContain('series_code')
  })

  it('eligiendo una serie, el payload la lleva exactamente', async () => {
    estado.series = [
      { codigo: 'COTI', esPorDefecto: true, autoridad: 'ERP' },
      { codigo: 'COT-ERP', esPorDefecto: false, autoridad: 'ERP' },
    ]
    montar()
    completarMinimo()
    fireEvent.change(screen.getByLabelText('Serie'), { target: { value: 'COT-ERP' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cotización' }))
    await waitFor(() => expect(espias.crear).toHaveBeenCalledTimes(1))

    const [, cabecera] = espias.crear.mock.calls[0]!
    expect(cabecera).toMatchObject({ series_code: 'COT-ERP' })
  })

  /** Fase 19 · E3 · §7-H: volver a la serie de STEL vuelve a bloquear. */
  it('volver a la serie por defecto vuelve a bloquear', () => {
    estado.series = DOS
    montar()
    completarMinimo()
    fireEvent.change(screen.getByLabelText('Serie'), { target: { value: 'COT-ERP' } })
    expect(screen.getByRole('button', { name: 'Crear cotización' })).toBeEnabled()

    fireEvent.change(screen.getByLabelText('Serie'), { target: { value: 'COTI' } })
    expect(screen.getByRole('button', { name: 'Crear cotización' })).toBeDisabled()
    expect(screen.getAllByText(/Emisión desde el ERP bloqueada/).length).toBeGreaterThan(0)
  })

  /**
   * §7-I: abrir la pantalla no escribe. Es lo que hace honesto abrir las
   * puertas de entrada: llegar hasta acá no consume un número ni crea nada.
   */
  it('abrir la pantalla no crea nada, ni siquiera con la serie ERP elegida', async () => {
    estado.series = DOS
    montar()
    completarMinimo()
    fireEvent.change(screen.getByLabelText('Serie'), { target: { value: 'COT-ERP' } })
    await act(async () => {})
    expect(espias.crear).not.toHaveBeenCalled()
  })

  /**
   * §7-D: se llega desde la ficha del cliente, y ese cliente es el que viaja.
   * La serie arranca igual en la de por defecto: entrar desde un cliente no
   * elige COT-ERP por nadie.
   */
  it('entrando desde un cliente, ese cliente viaja en el payload y la serie arranca en la de por defecto', async () => {
    estado.series = DOS
    montar(undefined, '/ventas/cotizaciones/nueva?cliente=c9')
    expect(screen.getByLabelText('Serie')).toHaveValue('COTI')
    expect(espias.crear).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'USD' } })
    fireEvent.change(screen.getByLabelText('Serie'), { target: { value: 'COT-ERP' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cotización' }))
    await waitFor(() => expect(espias.crear).toHaveBeenCalledTimes(1))

    const [, cabecera] = espias.crear.mock.calls[0]!
    expect(cabecera).toMatchObject({ customer_id: 'c9', series_code: 'COT-ERP' })
  })

  it('el motivo nombra LA SERIE y dice qué hacer, no habla del tipo entero', () => {
    estado.series = DOS
    montar()
    expect(screen.getAllByText(/la serie COTI la numera STEL/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/STEL numera las cotizaciones de esta empresa/)).toBeNull()
  })

  it('el desplegable dice qué numera cada serie', () => {
    estado.series = DOS
    montar()
    const opciones = [...screen.getByLabelText('Serie').querySelectorAll('option')].map((o) => o.textContent)
    expect(opciones[0]).toMatch(/COTI.*STEL/)
    expect(opciones[1]).toMatch(/COT-ERP.*ERP/)
  })
})
