// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type * as ServicioProductos from '../services/productosParaLinea'
import type * as ServicioCotizaciones from '../services/cotizaciones'
import type { DocumentoDetalle, LineaDocumento, Relacionados } from '../types'
import type { EventoAuditoria } from '../lib/trazabilidad'

/**
 * El pedido sobre el shell documental, con edición por borrador (Fase 15 · E4).
 *
 * Se mockea el cliente de Supabase —no la lógica— y los hooks de datos.
 * `editabilidadPedido`, `ordenarLineas`, los totales, la autoridad y los
 * permisos son los de producción. Lo que se prueba es lo que cambió en E4:
 * **el editor no escribe nada hasta «Guardar cambios»**, el guardado es uno
 * solo con el testigo de concurrencia, «Descartar» no escribe y salir con
 * cambios pregunta. Y lo que NO cambió: el pedido no mueve stock.
 */
const estado = vi.hoisted((): {
  rol: string
  stel: Record<string, boolean>
  doc: unknown
  relacionados: unknown
  /** Lo que devuelve la vista del servidor; sin definir = todavía no llegó. */
  revision: { historicos: string[]; activos: string[]; resueltos: string[]; noVerificables: string[]; requiereAtencion: boolean } | undefined
  series: { codigo: string; esPorDefecto: boolean; autoridad: string }[] | null
  eventos: unknown[]
  contactos: unknown[]
  direcciones: unknown[]
  tarifas: unknown[]
  vendedores: unknown[]
} => ({
  rol: 'admin',
  stel: {},
  doc: null,
  relacionados: null,
  revision: undefined,
  series: null,
  eventos: [],
  contactos: [],
  direcciones: [],
  tarifas: [],
  vendedores: [],
}))

const espias = vi.hoisted(() => ({
  guardar: vi.fn(
    (
      _orderId: string,
      _esperado: string,
      _cabecera: Record<string, string | number | null>,
      _lineas: Record<string, unknown>[],
    ) => Promise.resolve({ actualizadoEn: 'x', cambiosCabecera: 1, lineasTocadas: 0 }),
  ),
  cambiarEstado: vi.fn((_id: string, _desde: string, _hasta: string) => Promise.resolve()),
  buscar: vi.fn((_c: string, _t: string, _o?: { listaPrecioId?: string | null }) => Promise.resolve([])),
  // Fase 15 · E5: generar el remito es UNA llamada al servidor.
  remitar: vi.fn((_orderId: string, _cantidades: Map<string, number>, _fecha: string) =>
    Promise.resolve({ id: 'rem-1', numero: 'RT00001322', lineas: 1 }),
  ),
  pendientes: vi.fn((_c: string, _o: string) =>
    Promise.resolve([
      {
        orderLineId: 'ol1', productId: 'p1', sku: 'PRO10022', nombre: 'Candado de bloqueo LOTO',
        descripcion: null, pedida: 4, entregada: 1, pendiente: 3, precioUnitario: 100,
        descuentoPct: 0, tratamientoImpuesto: 'vat_21', tasaImpuesto: 21, stockLibre: 9,
      },
    ]),
  ),
}))

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
// La ficha rápida es de Clientes y trae sus propias consultas: acá sólo
// importa que el pedido la abra.
vi.mock('@/modules/clientes/components/PanelLateralCliente', () => ({
  PanelLateralCliente: ({ clienteId, onCerrar }: { clienteId: string; onCerrar: () => void }) => (
    <aside aria-label="Ficha rápida">
      <p>ficha rápida de {clienteId}</p>
      <button type="button" onClick={onCerrar}>
        Cerrar la ficha
      </button>
    </aside>
  ),
}))
vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({
    activa: { companyId: 'c1', companyName: 'ZZ Pruebas', rol: estado.rol, esInterno: true, customerId: null },
  }),
}))
vi.mock('../hooks/useAutoridadNumeracion', () => ({
  useAutoridadNumeracion: () => ({ stel: (t: string) => estado.stel[t] ?? false, cargando: false }),
}))
vi.mock('../hooks/useDocumentos', () => ({
  useDocumento: () => ({ data: estado.doc, isPending: false, error: null }),
  useRelacionados: () => ({ data: estado.relacionados, isPending: false }),
  // Fase 19 · E4: la autoridad de la serie del documento.
  useSeries: () => ({
    data:
      estado.series ??
      [{ codigo: 'PDV', esPorDefecto: true, autoridad: estado.stel['sales_order'] ? 'STEL' : 'ERP' }],
    isPending: false,
  }),
  // Fase 19 · E4: la clasificación de los motivos la hace el servidor.
  useRevision: () => ({ data: estado.revision, isPending: false }),
  useTrazabilidad: () => ({ data: estado.eventos, isPending: false, error: null }),
  usePendientes: () => ({ data: undefined, isPending: false }),
  useDisponibilidad: () => ({ data: undefined, isPending: false }),
  useContactos: () => ({ data: estado.contactos, isPending: false }),
  // Fase 17 · E3: los domicilios de entrega del cliente.
  useDireccionesEntrega: () => ({ data: estado.direcciones, isPending: false }),
  useTarifas: () => ({ data: estado.tarifas, isPending: false }),
  useVendedores: () => ({ data: estado.vendedores, isPending: false }),
}))
// El guardado es el único camino de escritura del editor; se espía para probar
// que NO se llama hasta apretar «Guardar cambios».
vi.mock('../services/pedidos', async (real) => ({
  ...(await real<Record<string, unknown>>()),
  guardarPedido: espias.guardar,
  cambiarEstadoPedido: espias.cambiarEstado,
}))
vi.mock('../services/entregas', async (real) => ({
  ...(await real<Record<string, unknown>>()),
  crearEntregaDesdePedido: espias.remitar,
  lineasParaEntregar: espias.pendientes,
}))
vi.mock('../services/productosParaLinea', async () => {
  const real = await vi.importActual<typeof ServicioProductos>('../services/productosParaLinea')
  return { ...real, buscarProductos: espias.buscar }
})
// El panel usa además `CLASES` y `TIPOS_ACEPTADOS`, que son datos, no
// escrituras: se dejan los de producción y se mockea sólo lo que toca la red.
vi.mock('../services/adjuntos', async (real) => ({
  ...(await real<Record<string, unknown>>()),
  listarAdjuntos: () => Promise.resolve([]),
  subirAdjunto: vi.fn(),
  borrarAdjunto: vi.fn(),
  urlDeDescarga: vi.fn(),
}))
vi.mock('../components/BuscadorCliente', () => ({
  BuscadorCliente: ({ onElegir }: { onElegir: (id: string | null) => void }) => (
    <button type="button" onClick={() => onElegir('cliente-2')}>
      elegir otro cliente
    </button>
  ),
}))

const { PedidoDetallePage } = await import('./PedidoDetallePage')

const linea = (p: Partial<LineaDocumento> = {}): LineaDocumento => ({
  id: 'l1',
  numeroLinea: 1,
  tipoLinea: 'item',
  productId: 'p1',
  sku: 'PRO10022',
  nombre: 'Candado de bloqueo LOTO',
  descripcion: 'Verde, cuerpo de nylon',
  cantidad: 4,
  precioUnitario: 100,
  descuentoPct: null,
  tratamientoImpuesto: 'vat_21',
  tasaImpuesto: 21,
  ordenLineaId: null,
  ...p,
})

const pedido = (p: Partial<DocumentoDetalle> = {}): DocumentoDetalle => ({
  id: 'o1',
  tipo: 'pedido',
  numero: 'PDV01321',
  numeroOriginal: 'PDV01321',
  numeroSospechado: null,
  fecha: '2026-09-16',
  clienteId: 'c9',
  clienteNombre: 'Consulta MercadoLibre',
  contactoNombre: null,
  contactoId: null,
  vendedorId: null,
  listaPrecioId: null,
  listaPrecioNombre: null,
  contactoRol: null,
  contactoEmail: null,
  contactoTelefono: null,
  titulo: 'VENTA MERCADO LIBRE VARIOS',
  moneda: 'ARS',
  tipoCambio: null,
  estado: 'draft',
  estadoSecundario: 'pending',
  vendedor: null,
  serie: 'PDV',
  notas: null,
  formaPago: null,
  transporte: null,
  seguimiento: null,
  domicilioEntrega: null,
  domicilioElegido: null,
  validaHasta: null,
  descuentoPct: null,
  percepcionPct: null,
  subtotal: 400,
  impuesto: 84,
  total: 484,
  necesitaRevision: false,
  motivosRevision: [],
  numeroFueraDeSerie: false,
  esHistorico: false,
  externalSource: null,
  creadoPor: null,
  creadoEn: '2026-09-16T12:00:00.000Z',
  actualizadoEn: '2026-09-16T12:30:00.000Z',
  lineas: [linea()],
  origen: null,
  ...p,
})

const sinRelacionados: Relacionados = {
  cotizaciones: [],
  pedidos: [],
  entregas: [],
  facturas: [],
  pagos: [],
}

/** Un data router de verdad: el aviso al salir con cambios usa `useBlocker`. */
const montar = (ruta = '/ventas/pedidos/o1', extra?: React.ReactNode) => {
  const router = createMemoryRouter(
    [
      {
        path: '/ventas/pedidos/:id',
        element: (
          <>
            {extra}
            <PedidoDetallePage />
          </>
        ),
      },
    ],
    { initialEntries: [ruta] },
  )
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const editar = () => fireEvent.click(screen.getByRole('button', { name: 'Editar' }))

beforeEach(() => {
  estado.rol = 'admin'
  estado.stel = {}
  estado.doc = pedido()
  estado.relacionados = sinRelacionados
  estado.eventos = []
  estado.contactos = []
  estado.tarifas = []
  estado.vendedores = []
  espias.guardar.mockClear()
  espias.cambiarEstado.mockClear()
  espias.buscar.mockClear()
  espias.remitar.mockClear()
  espias.pendientes.mockClear()
})

describe('Pedido · shell documental', () => {
  it('abre mostrando identidad, acciones y las seis pestañas, con Líneas primero', () => {
    montar()

    expect(screen.getByRole('heading', { level: 1, name: 'PDV01321' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText('Consulta MercadoLibre')).toBeInTheDocument()
    expect(screen.getAllByText('ARS 484,00').length).toBeGreaterThan(0)

    const pestanas = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(pestanas).toEqual(['Líneas1', 'Información', 'Entregas', 'Adjuntos', 'Relacionados', 'Trazabilidad'])
    expect(screen.getByRole('tab', { name: /Líneas/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Candado de bloqueo LOTO')).toBeInTheDocument()
  })

  it('los totales muestran las unidades y nunca mezclan monedas', () => {
    montar()
    const totales = screen.getByText('Unidades').closest('dl')!
    expect(within(totales).getByText('4')).toBeInTheDocument()
    expect(within(totales).getByText('ARS 400,00')).toBeInTheDocument()
    expect(within(totales).getByText('ARS 484,00')).toBeInTheDocument()
  })

  it('un enlace con la pestaña abre directo en esa pestaña', () => {
    montar('/ventas/pedidos/o1?tab=relacionados')
    expect(screen.getByRole('tab', { name: 'Relacionados' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('Pedido · edición por borrador', () => {
  it('Editar abre el modo edición con Guardar y Descartar, y nada más', () => {
    montar()
    editar()

    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument()
    expect(screen.getByText('Editando')).toBeInTheDocument()
    for (const nombre of ['Confirmar pedido', 'Duplicar', 'Ver / Imprimir', 'Eliminar']) {
      expect(screen.queryByRole('button', { name: nombre })).toBeNull()
    }
  })

  // Fase 17 · E3: el domicilio de entrega también se corrige en el pedido, y
  // viaja por el mismo camino que todo lo demás —una sola llamada, con testigo—.
  it('cambiar el domicilio de entrega viaja en el mismo guardado', async () => {
    estado.direcciones = [
      { id: 'd1', texto: 'Av. Siempreviva 742', esPrincipal: true, activa: true },
      { id: 'd2', texto: 'Depósito Norte', esPrincipal: false, activa: true },
    ]
    montar()
    editar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    fireEvent.change(screen.getByLabelText(/Entregar en/), { target: { value: 'd2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(espias.guardar).toHaveBeenCalledTimes(1))
    const [, , cabecera] = espias.guardar.mock.calls[0]!
    expect(cabecera).toEqual({ shipping_address_id: 'd2' })
  })

  it('quitar el domicilio manda null: el remito volverá a usar el principal del cliente', async () => {
    estado.direcciones = [{ id: 'd1', texto: 'Av. Siempreviva 742', esPrincipal: true, activa: true }]
    estado.doc = pedido({ direccionEntregaId: 'd1' })
    montar()
    editar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    expect(screen.getByLabelText(/Entregar en/)).toHaveValue('d1')
    fireEvent.change(screen.getByLabelText(/Entregar en/), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(espias.guardar).toHaveBeenCalledTimes(1))
    expect(espias.guardar.mock.calls[0]![2]).toEqual({ shipping_address_id: null })
  })

  it('un domicilio desactivado que el pedido YA nombra se sigue mostrando, marcado', () => {
    estado.direcciones = [{ id: 'd1', texto: 'La de antes', esPrincipal: false, activa: false }]
    estado.doc = pedido({ direccionEntregaId: 'd1' })
    montar()
    editar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    // Esconderla dejaría el desplegable en blanco y guardar borraría el dato
    // sin que nadie lo pidiera.
    expect(screen.getByLabelText(/Entregar en/)).toHaveValue('d1')
    expect(screen.getByRole('option', { name: /La de antes \(desactivada\)/ })).toBeInTheDocument()
  })

  it('sin cambios, Guardar está apagado', () => {
    montar()
    editar()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
    expect(screen.getByText(/Sin cambios todavía/)).toBeInTheDocument()
  })

  it('NO se escribe nada hasta apretar Guardar', () => {
    montar()
    editar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    fireEvent.change(screen.getByLabelText(/Título/), { target: { value: 'ZZ nuevo título' } })

    expect(espias.guardar).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled()
    expect(screen.getByText(/Hay cambios sin guardar/)).toBeInTheDocument()
  })

  it('Guardar manda UNA sola llamada, con el testigo de concurrencia y las columnas del pedido', async () => {
    montar()
    editar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    fireEvent.change(screen.getByLabelText(/Título/), { target: { value: 'ZZ nuevo título' } })
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-09-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(espias.guardar).toHaveBeenCalledTimes(1))
    const [orderId, esperado, cabecera, lineas] = espias.guardar.mock.calls[0]!
    expect(orderId).toBe('o1')
    expect(esperado).toBe('2026-09-16T12:30:00.000Z')
    expect(cabecera).toEqual({ title: 'ZZ nuevo título', order_date: '2026-09-20' })
    expect(lineas).toHaveLength(1)
    expect(lineas[0]).toMatchObject({ id: 'l1', line_no: 1, quantity: 4, unit_price: 100 })
    expect(await screen.findByText('El pedido y sus líneas se guardaron juntos.')).toBeInTheDocument()
  })

  it('editar las líneas tampoco escribe hasta guardar, y viajan en la misma llamada', async () => {
    montar()
    editar()
    fireEvent.change(screen.getAllByLabelText(/Cantidad/)[0]!, { target: { value: '7' } })
    expect(espias.guardar).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(espias.guardar).toHaveBeenCalledTimes(1))
    const [, , cabecera, lineas] = espias.guardar.mock.calls[0]!
    expect(cabecera).toEqual({})
    expect(lineas[0]).toMatchObject({ quantity: 7 })
  })

  it('Descartar con cambios pide confirmación y no escribe', () => {
    montar()
    editar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    fireEvent.change(screen.getByLabelText(/Título/), { target: { value: 'ZZ otro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))

    expect(screen.getByRole('alertdialog', { name: 'Hay cambios sin guardar' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Descartar cambios' }))

    expect(espias.guardar).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
  })

  it('un conflicto de edición conserva lo escrito y lo explica', async () => {
    const { FalloDeGuardado } = await vi.importActual<typeof ServicioCotizaciones>('../services/cotizaciones')
    espias.guardar.mockRejectedValueOnce(
      new FalloDeGuardado('CONFLICTO_DE_EDICION', 'Alguien más guardó este pedido mientras lo editabas.'),
    )
    montar()
    editar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    fireEvent.change(screen.getByLabelText(/Título/), { target: { value: 'ZZ lo que escribí' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText('Este pedido cambió mientras lo estabas editando')).toBeInTheDocument()
    // Lo escrito sigue en pantalla: es lo único que el usuario todavía tiene.
    expect(screen.getByLabelText(/Título/)).toHaveValue('ZZ lo que escribí')
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument()
  })

  it('cambiar de pestaña NO descarta el borrador ni pregunta', () => {
    montar()
    editar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    fireEvent.change(screen.getByLabelText(/Título/), { target: { value: 'ZZ sobrevive' } })

    fireEvent.click(screen.getByRole('tab', { name: /Líneas/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))

    expect(screen.getByLabelText(/Título/)).toHaveValue('ZZ sobrevive')
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled()
  })

  it('irse a otro pedido con cambios PREGUNTA antes de perder el borrador', async () => {
    montar('/ventas/pedidos/o1', <Link to="/ventas/pedidos/o2">ir a otro</Link>)
    editar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    fireEvent.change(screen.getByLabelText(/Título/), { target: { value: 'ZZ borrador de o1' } })

    fireEvent.click(screen.getByRole('link', { name: 'ir a otro' }))
    const dialogo = await screen.findByRole('alertdialog', { name: 'Hay cambios sin guardar' })
    expect(within(dialogo).getByText(/los cambios que hiciste se van a perder/)).toBeInTheDocument()

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Seguir editando' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText(/Título/)).toHaveValue('ZZ borrador de o1')
    expect(espias.guardar).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('link', { name: 'ir a otro' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Descartar y salir' }))

    // El pedido nuevo abre en lectura, sin el borrador del anterior.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
    expect(espias.guardar).not.toHaveBeenCalled()
  })

  it('con la edición cerrada, navegar no pregunta nada', async () => {
    montar('/ventas/pedidos/o1', <Link to="/ventas/pedidos/o2">ir a otro</Link>)
    fireEvent.click(screen.getByRole('link', { name: 'ir a otro' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('Pedido · tarifa', () => {
  it('el buscador de productos recibe la tarifa del pedido', async () => {
    estado.doc = pedido({ listaPrecioId: 'mayorista', listaPrecioNombre: 'Mayorista' })
    estado.tarifas = [{ id: 'mayorista', nombre: 'Mayorista', moneda: 'ARS' }]
    montar()
    editar()
    fireEvent.click(screen.getByRole('button', { name: 'Añadir producto' }))
    fireEvent.change(screen.getByLabelText(/Buscar por SKU/), { target: { value: 'candado' } })
    await waitFor(() => expect(espias.buscar).toHaveBeenCalled(), { timeout: 2000 })
    expect(espias.buscar.mock.calls.at(-1)![2]).toEqual({ listaPrecioId: 'mayorista' })
  })

  it('cambiar la tarifa NO recalcula las líneas ya cargadas', () => {
    estado.doc = pedido({ listaPrecioId: 'lista', listaPrecioNombre: 'Lista base' })
    estado.tarifas = [
      { id: 'lista', nombre: 'Lista base', moneda: 'ARS' },
      { id: 'mayorista', nombre: 'Mayorista', moneda: 'ARS' },
    ]
    montar()
    editar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    fireEvent.change(screen.getByLabelText(/Tarifa/), { target: { value: 'mayorista' } })

    fireEvent.click(screen.getByRole('tab', { name: /Líneas/ }))
    expect(screen.getAllByLabelText(/Precio/)[0]!).toHaveValue(100)
  })

  it('en lectura, Información muestra la tarifa registrada y no la inventa', () => {
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    expect(screen.getByText('Tarifa')).toBeInTheDocument()
    expect(screen.getAllByText('Sin registrar').length).toBeGreaterThan(0)
  })

  it('el pedido no tiene fecha de validez ni en edición', () => {
    montar()
    editar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    expect(screen.getByLabelText('Fecha')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Válida hasta/)).toBeNull()
  })
})

describe('Pedido · permisos, estados y autoridad', () => {
  it('quien no escribe no ve acciones de escritura', () => {
    estado.rol = 'salesperson'
    montar()
    for (const nombre of ['Editar', 'Confirmar pedido', 'Eliminar']) {
      expect(screen.queryByRole('button', { name: nombre })).toBeNull()
    }
    expect(screen.getByText(/Tu rol no edita pedidos/)).toBeInTheDocument()
  })

  it('un pedido cancelado no se edita y lo dice', () => {
    estado.doc = pedido({ estado: 'cancelled' })
    montar()
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
    expect(screen.getByText('El pedido está cancelado.')).toBeInTheDocument()
  })

  it('con entregas, las líneas quedan congeladas y se explica', () => {
    estado.relacionados = {
      ...sinRelacionados,
      entregas: [
        { tipo: 'entrega', id: 'e1', numero: 'REM00120', fecha: '2026-09-17', estado: 'confirmed', moneda: 'ARS', total: 0 },
      ],
    }
    montar()
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
    expect(screen.getByText('El pedido ya tiene entregas: sus líneas no se modifican.')).toBeInTheDocument()
  })

  it('un pedido confirmado se edita, avisando que los cambios quedan registrados', () => {
    estado.doc = pedido({ estado: 'confirmed' })
    montar()
    expect(screen.getByRole('button', { name: 'Editar' })).toBeEnabled()
    expect(screen.getByText(/los cambios de precio quedan registrados/)).toBeInTheDocument()
  })

  it('con la numeración de entregas en STEL, generar el remito se ve deshabilitado y con el motivo', () => {
    estado.doc = pedido({ estado: 'confirmed' })
    estado.stel = { delivery: true }
    montar()
    const generar = screen.getByRole('button', { name: 'Generar nota de entrega' })
    expect(generar).toBeVisible()
    expect(generar).toBeDisabled()
    expect(generar).toHaveAccessibleDescription(/Emisión desde el ERP bloqueada/)
    // Aunque la emisión esté bloqueada, editar y guardar siguen disponibles.
    expect(screen.getByRole('button', { name: 'Editar' })).toBeEnabled()
  })

  it('el bloqueo de autoridad se cuenta UNA vez por pantalla', () => {
    estado.stel = { sales_order: true, delivery: true }
    montar()
    expect(screen.getAllByTestId('aviso-autoridad-stel')).toHaveLength(1)
  })

  it('confirmar el pedido es una transición explícita, no algo que pase al guardar', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pedido' }))
    await waitFor(() => expect(espias.cambiarEstado).toHaveBeenCalledTimes(1))
    expect(espias.cambiarEstado.mock.calls[0]).toEqual(['o1', 'draft', 'confirmed'])
    expect(espias.guardar).not.toHaveBeenCalled()
  })
})

describe('Pedido · pestañas', () => {
  it('Entregas muestra los pendientes y el stock como información, sin moverlo', () => {
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Entregas' }))
    expect(screen.getByRole('heading', { name: 'Entregas' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Stock' })).toBeInTheDocument()
    expect(espias.guardar).not.toHaveBeenCalled()
  })

  it('Relacionados muestra la cadena real y enlaza la cotización de origen', () => {
    estado.relacionados = {
      ...sinRelacionados,
      cotizaciones: [
        { tipo: 'cotizacion', id: 'q1', numero: 'COTI02558', fecha: '2026-09-16', estado: 'accepted', moneda: 'ARS', total: 484 },
      ],
    }
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Relacionados' }))
    expect(screen.getByRole('link', { name: /COTI02558/ })).toHaveAttribute('href', '/ventas/cotizaciones/q1')
  })

  it('Información enlaza la cotización de la que nació el pedido', () => {
    estado.doc = pedido({ origen: { tipo: 'cotizacion', id: 'q1', numero: 'COTI02558' } })
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    expect(screen.getByText('Cotización de origen')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'COTI02558' })).toHaveAttribute('href', '/ventas/cotizaciones/q1')
  })

  it('Trazabilidad cuenta los hechos en castellano, sin ids ni JSON', () => {
    const eventos: EventoAuditoria[] = [
      {
        id: 9,
        accion: 'updated_sensitive_fields',
        desde: null,
        hasta: null,
        diff: { unit_price: { from: 120, to: 100 } },
        actor: 'Lisandro',
        fecha: '2026-09-16T14:32:00.000Z',
      },
    ]
    estado.eventos = eventos
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Trazabilidad' }))

    expect(screen.getByText('Cambio en precios o cantidades')).toBeInTheDocument()
    expect(screen.getByText('Precio unitario: 120 → 100')).toBeInTheDocument()
    expect(screen.queryByText(/unit_price/)).toBeNull()
  })

  it('Adjuntos dice que no hay, sin prometer nada más', async () => {
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Adjuntos' }))
    expect(await screen.findByText('Sin archivos adjuntos.')).toBeInTheDocument()
  })
})

/**
 * Pedido → remito (Fase 15 · E5).
 *
 * Desde el pedido, el modal ofrece lo PENDIENTE —no lo pedido— y generar es
 * una sola llamada al servidor, que vuelve a calcular el pendiente y bloquea
 * la sobreentrega. La pantalla no escribe nada hasta ese botón.
 */
/**
 * Fase 19 · E4 · los avisos de la migración contra el dato de hoy.
 *
 * El caso es PDV01315, de producción: avisaba «Sin moneda», «Algún producto no
 * está en el catálogo», «Los totales no cierran» y «Sin cotización de origen»
 * con moneda, productos resueltos, totales cerrados y su cotización enlazada.
 */
describe('Pedido · avisos de la migración', () => {
  /**
   * Los valores son los que devuelve la vista `revision_de_documentos` para
   * PDV01315, medidos en producción: tres motivos que el dato desmiente y el
   * de los totales, que sigue siendo cierto porque sus dos líneas al 0 % no
   * dan los USD 138,64 de impuesto de la cabecera.
   */
  const PDV01315 = {
    historicos: ['MISSING_CURRENCY', 'NO_QUOTE_LINK', 'TOTALS_DO_NOT_CLOSE', 'UNRESOLVED_SKU'],
    activos: ['TOTALS_DO_NOT_CLOSE'],
    resueltos: ['MISSING_CURRENCY', 'NO_QUOTE_LINK', 'UNRESOLVED_SKU'],
    noVerificables: [],
    requiereAtencion: true,
  }

  it('lo que sigue pasando se avisa, y lo que el dato desmiente se cuenta aparte', () => {
    estado.doc = pedido({ esHistorico: true, necesitaRevision: true, motivosRevision: PDV01315.historicos })
    estado.revision = PDV01315
    montar()

    const aviso = screen.getByText('Documento histórico con observaciones').closest('div')!
    expect(within(aviso).getByRole('listitem')).toHaveTextContent('Los totales no cierran')
    expect(aviso).toHaveTextContent(/pero eso ya no pasa/i)
    expect(aviso).toHaveTextContent(/sin moneda/i)
  })

  it('con TODO desmentido no se muestra una advertencia, y no se esconde que sigue en la cola', () => {
    estado.doc = pedido({ esHistorico: true, necesitaRevision: true, motivosRevision: ['MISSING_CURRENCY'] })
    estado.revision = {
      historicos: ['MISSING_CURRENCY'],
      activos: [],
      resueltos: ['MISSING_CURRENCY'],
      noVerificables: [],
      requiereAtencion: false,
    }
    montar()

    expect(screen.queryByText('Documento histórico con observaciones')).toBeNull()
    const nota = screen.getByTestId('avisos-historicos-resueltos')
    expect(nota).toHaveTextContent(/los datos de hoy ya no lo dicen/i)
    expect(nota).toHaveTextContent(/cola de revisión/i)
  })

  /** Falta de evidencia no es «resuelto»: se sigue avisando. */
  it('un motivo que no se puede verificar se sigue mostrando como observación', () => {
    estado.doc = pedido({ esHistorico: true, motivosRevision: ['DELIVERED_BY_ARRAY_INDEX'] })
    estado.revision = {
      historicos: ['DELIVERED_BY_ARRAY_INDEX'],
      activos: [],
      resueltos: [],
      noVerificables: ['DELIVERED_BY_ARRAY_INDEX'],
      requiereAtencion: true,
    }
    montar()
    expect(screen.getByText('Entregas registradas por posición')).toBeInTheDocument()
    expect(screen.queryByTestId('avisos-historicos-resueltos')).toBeNull()
  })

  /** Mientras la clasificación no llegó no se apaga nada: se muestra lo guardado. */
  it('sin la respuesta del servidor se muestran los motivos históricos tal cual', () => {
    estado.doc = pedido({ esHistorico: true, motivosRevision: ['MISSING_CURRENCY'] })
    estado.revision = undefined
  estado.series = null
    montar()
    expect(screen.getByText('Sin moneda')).toBeInTheDocument()
  })
})

/**
 * Fase 19 · E4: la ficha rápida del cliente, sin salir del pedido. Es el mismo
 * componente que abre el listado de Clientes y la cotización.
 */
/**
 * Fase 19 · E4 · la serie del pedido manda sobre la autoridad general.
 *
 * Es el mismo caso que en la cotización, visto en el piloto PDV-ERP00001: el
 * documento lo numeró el ERP y la pantalla decía que lo numeraba STEL.
 */
describe('Pedido · la serie del documento', () => {
  const DOS = [
    { codigo: 'PDV', esPorDefecto: true, autoridad: 'STEL' },
    { codigo: 'PDV-ERP', esPorDefecto: false, autoridad: 'ERP' },
  ]

  it('un pedido de la serie del ERP no se anuncia como numerado por STEL', () => {
    estado.stel = { sales_order: true, delivery: true }
    estado.series = DOS
    estado.doc = pedido({ serie: 'PDV-ERP', numero: 'PDV-ERP00001', estado: 'draft' })
    montar()

    expect(screen.queryByText(/STEL numera los pedidos y las notas de entrega/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Confirmar pedido' })).toBeEnabled()
    // Lo que sigue en STEL es el remito que saldría de él, y así se dice.
    expect(screen.getByText(/numeración de los documentos que salen de este/)).toBeVisible()
  })

  it('un pedido de la serie que STEL numera sigue bloqueado', () => {
    estado.stel = { sales_order: true, delivery: true }
    estado.series = DOS
    estado.doc = pedido({ serie: 'PDV', estado: 'draft' })
    montar()
    expect(screen.getByRole('button', { name: 'Confirmar pedido' })).toBeDisabled()
    expect(screen.getByText(/STEL numera los pedidos y las notas de entrega/)).toBeVisible()
  })
})

describe('Pedido · ficha rápida del cliente', () => {
  it('el nombre del cliente abre la ficha, y se puede cerrar sin perder el pedido', () => {
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    fireEvent.click(screen.getByRole('button', { name: 'Consulta MercadoLibre' }))

    expect(screen.getByRole('complementary', { name: 'Ficha rápida' })).toBeInTheDocument()
    expect(screen.getByText('ficha rápida de c9')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar la ficha' }))
    expect(screen.queryByRole('complementary', { name: 'Ficha rápida' })).toBeNull()
    // El pedido sigue donde estaba: abrir la ficha no navega a ningún lado.
    expect(screen.getByRole('heading', { level: 1, name: /PDV/ })).toBeInTheDocument()
  })
})

describe('Pedido · generar remito', () => {
  const confirmado = () => {
    estado.doc = pedido({ estado: 'confirmed' })
  }

  it('el modal ofrece el pendiente, no lo pedido', async () => {
    confirmado()
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Generar nota de entrega' }))

    const dialogo = await screen.findByRole('dialog', { name: 'Generar nota de entrega' })
    expect(await within(dialogo).findByLabelText(/Cantidad a entregar de PRO10022/)).toHaveValue(3)
    expect(espias.remitar).not.toHaveBeenCalled()
  })

  it('generar es UNA llamada con las cantidades elegidas', async () => {
    confirmado()
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Generar nota de entrega' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Generar nota de entrega' })
    fireEvent.change(await within(dialogo).findByLabelText(/Cantidad a entregar de PRO10022/), { target: { value: '2' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Generar remito' }))

    await waitFor(() => expect(espias.remitar).toHaveBeenCalledTimes(1))
    const [orderId, cantidades] = espias.remitar.mock.calls[0]!
    expect(orderId).toBe('o1')
    expect([...cantidades.entries()]).toEqual([['ol1', 2]])
    // Generar un remito no guarda el pedido ni cambia su estado.
    expect(espias.guardar).not.toHaveBeenCalled()
    expect(espias.cambiarEstado).not.toHaveBeenCalled()
  })

  it('no se puede pedir más que el pendiente', async () => {
    confirmado()
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Generar nota de entrega' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Generar nota de entrega' })
    const campo = await within(dialogo).findByLabelText(/Cantidad a entregar de PRO10022/)
    expect(campo).toHaveAttribute('max', '3')
    fireEvent.change(campo, { target: { value: '9' } })
    expect(campo).toHaveValue(3)
  })

  it('un pedido sin pendiente lo dice, en vez de generar un remito vacío', async () => {
    confirmado()
    espias.pendientes.mockResolvedValueOnce([
      {
        orderLineId: 'ol1', productId: 'p1', sku: 'PRO10022', nombre: 'Candado de bloqueo LOTO',
        descripcion: null, pedida: 4, entregada: 4, pendiente: 0, precioUnitario: 100,
        descuentoPct: 0, tratamientoImpuesto: 'vat_21', tasaImpuesto: 21, stockLibre: 9,
      },
    ])
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Generar nota de entrega' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Generar nota de entrega' })
    expect(await within(dialogo).findByText(/ya está entregado por completo/)).toBeInTheDocument()
    expect(within(dialogo).getByRole('button', { name: 'Generar remito' })).toBeDisabled()
  })

  it('si el servidor rechaza, se dice en castellano y no se navega', async () => {
    const { FalloDeGuardado } = await vi.importActual<typeof ServicioCotizaciones>('../services/cotizaciones')
    espias.remitar.mockRejectedValueOnce(
      new FalloDeGuardado('SOBREENTREGA', 'Se quiso entregar más de lo que queda pendiente.'),
    )
    confirmado()
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Generar nota de entrega' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Generar nota de entrega' })
    await within(dialogo).findByLabelText(/Cantidad a entregar de PRO10022/)
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Generar remito' }))

    expect(await within(dialogo).findByText('Se quiso entregar más de lo que queda pendiente.')).toBeInTheDocument()
  })

  it('con la numeración de entregas en STEL no se ofrece generar', () => {
    confirmado()
    estado.stel = { delivery: true }
    montar()
    expect(screen.getByRole('button', { name: 'Generar nota de entrega' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Generar nota de entrega' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
