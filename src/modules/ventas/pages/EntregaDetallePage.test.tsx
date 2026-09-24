// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type * as ServicioCotizaciones from '../services/cotizaciones'
import type { DocumentoDetalle, LineaDocumento, Relacionados } from '../types'
import type { EventoAuditoria } from '../lib/trazabilidad'

/**
 * El remito sobre el shell documental, con edición del borrador (Fase 15 · E5).
 *
 * Se mockean los datos y las escrituras; `editabilidadEntrega`, el borrador,
 * la autoridad y los permisos son los de producción. Lo que importa probar:
 * **editar un remito no escribe nada hasta Guardar**, guardar es UNA llamada
 * con el testigo, despachar es lo único que mueve stock y un remito despachado
 * no se edita.
 */
const estado = vi.hoisted((): {
  rol: string
  stel: Record<string, boolean>
  doc: unknown
  relacionados: unknown
  /** Lo que devuelve la vista del servidor; sin definir = todavía no llegó. */
  revision: { historicos: string[]; activos: string[]; resueltos: string[]; noVerificables: string[]; requiereAtencion: boolean } | undefined
  series: { codigo: string; esPorDefecto: boolean; autoridad: string }[] | null
  avance: { lineas: unknown[]; sinEnlazar: number; repartoDudoso: boolean } | undefined
  eventos: unknown[]
  contactos: unknown[]
  pendientes: unknown[]
  /** Fase 26 · E2: con pantalla ancha la hoja del documento va al lado. */
  pantallaAncha: boolean
} => ({ rol: 'admin', stel: {}, doc: null, relacionados: null, revision: undefined, series: null, avance: undefined, eventos: [], contactos: [], pendientes: [], pantallaAncha: false }))

const espias = vi.hoisted(() => ({
  guardar: vi.fn(
    (
      _deliveryId: string,
      _esperado: string,
      _cabecera: Record<string, string | number | null>,
      _lineas: Record<string, unknown>[],
    ) => Promise.resolve({ actualizadoEn: 'x', cambiosCabecera: 1, lineasTocadas: 1 }),
  ),
  confirmar: vi.fn((_id: string) =>
    Promise.resolve({ yaConfirmada: false, status: 'shipped', movimientos: 1, reservasLiberadas: 0 }),
  ),
  pendientes: vi.fn((_c: string, _o: string) => Promise.resolve(estado.pendientes)),
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
  // Fase 19 · E4: la clasificación de los motivos la hace el servidor.
  useRevision: () => ({ data: estado.revision, isPending: false }),
  // Fase 19 · E5: el avance contra el pedido.
  useAvanceDeRemito: () => ({ data: estado.avance, isPending: false }),
  // Fase 19 · E5: las series del tipo. Sin fila propia, la autoridad general.
  useSeries: (tipo: string) => ({
    data:
      estado.series ??
      [{
        codigo: tipo === 'entrega' ? 'RT' : 'PDV',
        esPorDefecto: true,
        autoridad: estado.stel[tipo === 'entrega' ? 'delivery' : 'sales_order'] ? 'STEL' : 'ERP',
      }],
    isPending: false,
  }),
  useTrazabilidad: () => ({ data: estado.eventos, isPending: false, error: null }),
  useContactos: () => ({ data: estado.contactos, isPending: false }),
}))
vi.mock('../services/entregas', async (real) => ({
  ...(await real<Record<string, unknown>>()),
  guardarRemito: espias.guardar,
  confirmarEntrega: espias.confirmar,
  lineasParaEntregar: espias.pendientes,
}))
// El panel usa además `CLASES` y `TIPOS_ACEPTADOS`, que son datos, no
// escrituras: se dejan los de producción y se mockea sólo lo que toca la red.
vi.mock('../services/adjuntos', async (real) => ({
  ...(await real<Record<string, unknown>>()),
  listarAdjuntos: () => Promise.resolve([]),
  subirAdjunto: vi.fn(),
  borrarAdjunto: vi.fn(),
  urlDeDescarga: vi.fn(),
}))

const { EntregaDetallePage } = await import('./EntregaDetallePage')

const linea = (p: Partial<LineaDocumento> = {}): LineaDocumento => ({
  id: 'dl1',
  numeroLinea: 1,
  tipoLinea: 'item',
  productId: 'p1',
  sku: 'PRO10022',
  nombre: 'Candado de bloqueo LOTO',
  descripcion: null,
  cantidad: 4,
  precioUnitario: 100,
  descuentoPct: null,
  tratamientoImpuesto: 'vat_21',
  tasaImpuesto: 21,
  ordenLineaId: 'ol1',
  ...p,
})

const remito = (p: Partial<DocumentoDetalle> = {}): DocumentoDetalle => ({
  id: 'd1',
  tipo: 'entrega',
  numero: 'RT00001321',
  numeroOriginal: 'RT00001321',
  numeroSospechado: null,
  fecha: '2026-09-18',
  clienteId: 'c9',
  clienteNombre: 'Consulta MercadoLibre',
  clienteCuit: null,
  contactoNombre: null,
  contactoId: null,
  vendedorId: null,
  listaPrecioId: null,
  listaPrecioNombre: null,
  contactoRol: null,
  contactoEmail: null,
  contactoTelefono: null,
  titulo: 'ENTREGA PARCIAL',
  moneda: 'ARS',
  tipoCambio: null,
  estado: 'draft',
  estadoSecundario: null,
  vendedor: null,
  serie: 'RT',
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
  creadoEn: '2026-09-18T12:00:00.000Z',
  actualizadoEn: '2026-09-18T12:30:00.000Z',
  lineas: [linea()],
  origen: { tipo: 'pedido', id: 'o1', numero: 'PDV01321' },
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
const montar = (ruta = '/ventas/entregas/d1', extra?: React.ReactNode) => {
  const router = createMemoryRouter(
    [
      {
        path: '/ventas/entregas/:id',
        element: (
          <>
            {extra}
            <EntregaDetallePage />
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
  estado.doc = remito()
  estado.relacionados = sinRelacionados
  estado.eventos = []
  estado.contactos = []
  // 10 pedidas, 4 en este remito, 6 pendientes.
  estado.pendientes = [
    {
      orderLineId: 'ol1', productId: 'p1', sku: 'PRO10022', nombre: 'Candado de bloqueo LOTO',
      descripcion: null, pedida: 10, entregada: 4, pendiente: 6, precioUnitario: 100,
      descuentoPct: 0, tratamientoImpuesto: 'vat_21', tasaImpuesto: 21, stockLibre: 30,
    },
    {
      orderLineId: 'ol2', productId: 'p2', sku: 'PRO10099', nombre: 'Pinza',
      descripcion: null, pedida: 5, entregada: 0, pendiente: 5, precioUnitario: 50,
      descuentoPct: 0, tratamientoImpuesto: 'vat_21', tasaImpuesto: 21, stockLibre: 10,
    },
  ]
  estado.pantallaAncha = false
  espias.guardar.mockClear()
  espias.confirmar.mockClear()
  espias.pendientes.mockClear()
})

describe('Remito · shell documental', () => {
  it('abre mostrando identidad, serie y las cinco pestañas, con Líneas primero', () => {
    montar()
    expect(screen.getByRole('heading', { level: 1, name: 'RT00001321' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText('Serie RT')).toBeInTheDocument()
    expect(screen.getByText('Consulta MercadoLibre')).toBeInTheDocument()

    const pestanas = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(pestanas).toEqual(['Líneas1', 'Información', 'Adjuntos', 'Relacionados', 'Trazabilidad'])
    expect(screen.getByRole('tab', { name: /Líneas/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Candado de bloqueo LOTO')).toBeInTheDocument()
  })

  it('un enlace con la pestaña abre directo en esa pestaña', () => {
    montar('/ventas/entregas/d1?tab=trazabilidad')
    expect(screen.getByRole('tab', { name: 'Trazabilidad' })).toHaveAttribute('aria-selected', 'true')
  })

  it('Información enlaza el pedido de origen', () => {
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    expect(screen.getByText('Pedido de origen')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'PDV01321' })).toHaveAttribute('href', '/ventas/pedidos/o1')
  })

  it('un remito sin pedido lo dice, no lo inventa', () => {
    estado.doc = remito({ origen: null })
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    expect(screen.getByText('Sin pedido relacionado')).toBeInTheDocument()
  })

  it('muestra transporte y seguimiento sólo cuando existen', () => {
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    expect(screen.queryByText('Transporte')).toBeNull()

    estado.doc = remito({ transporte: 'Andreani', seguimiento: 'AR-993' })
    montar()
    fireEvent.click(screen.getAllByRole('tab', { name: 'Información' })[1]!)
    expect(screen.getByText('Andreani')).toBeInTheDocument()
    expect(screen.getByText('AR-993')).toBeInTheDocument()
  })

  it('Trazabilidad cuenta los hechos en castellano', () => {
    const eventos: EventoAuditoria[] = [
      {
        id: 3, accion: 'stock_consumed', desde: null, hasta: null,
        diff: { lineas: 1 }, actor: 'Lisandro', fecha: '2026-09-18T14:00:00.000Z',
      },
    ]
    estado.eventos = eventos
    montar('/ventas/entregas/d1?tab=trazabilidad')
    expect(screen.queryByText(/stock_consumed/)).toBeNull()
  })
})

describe('Remito · acciones y estados', () => {
  it('en borrador ofrece despachar y editar, y explica qué hace despachar', () => {
    montar()
    expect(screen.getByRole('button', { name: 'Confirmar y despachar' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Editar' })).toBeEnabled()
    expect(screen.getByText(/Descuenta el stock de cada línea/)).toBeInTheDocument()
  })

  it('despachado no se edita ni se despacha de nuevo, y lo explica', () => {
    estado.doc = remito({ estado: 'shipped' })
    montar()
    expect(screen.queryByRole('button', { name: 'Confirmar y despachar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
    expect(screen.getByText('El remito ya fue despachado: movió stock y no se modifica.')).toBeInTheDocument()
  })

  it('cancelado tampoco', () => {
    estado.doc = remito({ estado: 'cancelled' })
    montar()
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
    expect(screen.getByText('El remito está cancelado.')).toBeInTheDocument()
  })

  it('un remito migrado se consulta pero no se edita', () => {
    estado.doc = remito({ esHistorico: true })
    montar()
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
    expect(screen.getByText(/migrado del sistema anterior: se consulta, no se edita/)).toBeInTheDocument()
    // Despachar sigue disponible: es lo que hace el circuito, no la edición.
    expect(screen.getByRole('button', { name: 'Confirmar y despachar' })).toBeEnabled()
  })

  it('quien no escribe no ve acciones de escritura', () => {
    estado.rol = 'salesperson'
    montar()
    expect(screen.queryByRole('button', { name: 'Confirmar y despachar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
    expect(screen.getByText(/Tu rol no despacha remitos/)).toBeInTheDocument()
  })

  it('con la numeración en STEL, despachar se ve deshabilitado y con el motivo', () => {
    estado.stel = { delivery: true }
    montar()
    const despachar = screen.getByRole('button', { name: 'Confirmar y despachar' })
    expect(despachar).toBeVisible()
    expect(despachar).toBeDisabled()
    expect(despachar).toHaveAccessibleDescription(/bloqueado hasta completar la migración/)
    // Editar el borrador sigue disponible: no mueve stock.
    expect(screen.getByRole('button', { name: 'Editar' })).toBeEnabled()
  })

  it('despachar es UNA llamada y cuenta lo que movió', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y despachar' }))
    await waitFor(() => expect(espias.confirmar).toHaveBeenCalledTimes(1))
    expect(espias.confirmar.mock.calls[0]![0]).toBe('d1')
    expect(await screen.findByText(/Despachado\. 1 movimiento\(s\) de stock/)).toBeInTheDocument()
  })

  it('si ya estaba despachado, lo dice sin repetir el movimiento', async () => {
    espias.confirmar.mockResolvedValueOnce({ yaConfirmada: true, status: 'shipped', movimientos: 0, reservasLiberadas: 0 })
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y despachar' }))
    expect(await screen.findByText(/no se repitió ningún movimiento de stock/)).toBeInTheDocument()
  })
})

describe('Remito · edición del borrador', () => {
  it('Editar abre el modo edición con Guardar y Descartar, y nada más', () => {
    montar()
    editar()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument()
    expect(screen.getByText('Editando')).toBeInTheDocument()
    for (const nombre of ['Confirmar y despachar', 'Ver / Imprimir', 'Eliminar']) {
      expect(screen.queryByRole('button', { name: nombre })).toBeNull()
    }
  })

  it('sin cambios, Guardar está apagado y se dice que editar no mueve stock', () => {
    montar()
    editar()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
    expect(screen.getByText(/Editar un remito en borrador no mueve stock/)).toBeInTheDocument()
  })

  it('NO se escribe nada hasta apretar Guardar', () => {
    montar()
    editar()
    fireEvent.change(screen.getByLabelText(/Cantidad de PRO10022/), { target: { value: '6' } })
    expect(espias.guardar).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled()
    expect(screen.getByText(/Hay cambios sin guardar/)).toBeInTheDocument()
  })

  it('Guardar manda UNA llamada, con el testigo y las columnas del remito', async () => {
    montar()
    editar()
    fireEvent.change(screen.getByLabelText(/Cantidad de PRO10022/), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    fireEvent.change(screen.getByLabelText(/Transporte/), { target: { value: 'Andreani' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(espias.guardar).toHaveBeenCalledTimes(1))
    const [deliveryId, esperado, cabecera, lineas] = espias.guardar.mock.calls[0]!
    expect(deliveryId).toBe('d1')
    expect(esperado).toBe('2026-09-18T12:30:00.000Z')
    expect(cabecera).toEqual({ carrier: 'Andreani' })
    expect(lineas).toEqual([
      { id: 'dl1', order_line_id: 'ol1', quantity: 6, description_snapshot: null },
    ])
    expect(await screen.findByText(/Cambios guardados/)).toBeInTheDocument()
  })

  it('una cantidad en cero no se puede guardar, y se dice por qué', () => {
    montar()
    editar()
    fireEvent.change(screen.getByLabelText(/Cantidad de PRO10022/), { target: { value: '0' } })
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
    expect(screen.getByText(/mayores que cero/)).toBeInTheDocument()
  })

  it('quitar todas las líneas tampoco se guarda', () => {
    montar()
    editar()
    fireEvent.click(screen.getByRole('button', { name: /Quitar PRO10022/ }))
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
    expect(screen.getByText(/Un remito sin líneas no es un remito/)).toBeInTheDocument()
  })

  it('el tope de cada línea es el pendiente MÁS lo que este remito ya tenía', async () => {
    montar()
    editar()
    // 6 pendientes + 4 de este remito = 10, que es lo pedido. El pendiente lo
    // trae una consulta, así que se espera a que llegue.
    await waitFor(() =>
      expect(screen.getByLabelText(/Cantidad de PRO10022/)).toHaveAttribute('max', '10'),
    )
  })

  it('muestra lo pedido y lo que quedaría pendiente después de este remito', async () => {
    montar()
    editar()
    const fila = screen.getByLabelText(/Cantidad de PRO10022/).closest('tr')!
    await waitFor(() => expect(within(fila).getByText('10')).toBeInTheDocument())
    expect(within(fila).getByText('6')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Cantidad de PRO10022/), { target: { value: '10' } })
    expect(within(fila).getByText('0')).toBeInTheDocument()
  })

  it('se puede sumar una línea pendiente del pedido, y viaja sin id', async () => {
    montar()
    editar()
    fireEvent.change(await screen.findByLabelText('Línea del pedido para agregar'), { target: { value: 'ol2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(espias.guardar).toHaveBeenCalledTimes(1))
    const lineas = espias.guardar.mock.calls[0]![3]
    expect(lineas).toHaveLength(2)
    expect(lineas[1]).toEqual({ order_line_id: 'ol2', quantity: 5, description_snapshot: null })
  })

  it('Descartar con cambios pide confirmación y no escribe', () => {
    montar()
    editar()
    fireEvent.change(screen.getByLabelText(/Cantidad de PRO10022/), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))

    expect(screen.getByRole('alertdialog', { name: 'Hay cambios sin guardar' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Descartar cambios' }))

    expect(espias.guardar).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
  })

  it('un conflicto conserva lo escrito y lo explica', async () => {
    const { FalloDeGuardado } = await vi.importActual<typeof ServicioCotizaciones>('../services/cotizaciones')
    espias.guardar.mockRejectedValueOnce(
      new FalloDeGuardado('CONFLICTO_DE_EDICION', 'Alguien más guardó este remito mientras lo editabas.'),
    )
    montar()
    editar()
    fireEvent.change(screen.getByLabelText(/Cantidad de PRO10022/), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText('Este remito cambió mientras lo estabas editando')).toBeInTheDocument()
    expect(screen.getByLabelText(/Cantidad de PRO10022/)).toHaveValue(7)
  })

  it('irse con cambios PREGUNTA antes de perder el borrador', async () => {
    montar('/ventas/entregas/d1', <Link to="/ventas/entregas/d2">ir a otro</Link>)
    editar()
    fireEvent.change(screen.getByLabelText(/Cantidad de PRO10022/), { target: { value: '3' } })

    fireEvent.click(screen.getByRole('link', { name: 'ir a otro' }))
    const dialogo = await screen.findByRole('alertdialog', { name: 'Hay cambios sin guardar' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Seguir editando' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText(/Cantidad de PRO10022/)).toHaveValue(3)

    fireEvent.click(screen.getByRole('link', { name: 'ir a otro' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Descartar y salir' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument())
    expect(espias.guardar).not.toHaveBeenCalled()
  })

  it('el precio no se edita en el remito, y se dice por qué', () => {
    montar()
    editar()
    expect(screen.queryByLabelText(/Precio/)).toBeNull()
    expect(screen.getByText(/un remito dice qué se entrega, no a qué precio se vendió/)).toBeInTheDocument()
  })
})

/**
 * Fase 19 · E5 · los cuatro números del remito contra su pedido.
 *
 * Lo que está en un remito sin despachar todavía no salió: se cuenta en «esta
 * entrega», no en «ya entregado».
 */
describe('Remito · avance del pedido', () => {
  const AVANCE = {
    lineas: [
      { lineaPedidoId: 'ol1', sku: 'ZZ-1', nombre: 'Producto', pedido: 10, yaEntregado: 4, estaEntrega: 6, pendienteDespues: 0 },
    ],
    sinEnlazar: 0,
    repartoDudoso: false,
  }

  it('muestra pedido, ya entregado, esta entrega y lo que quedaría pendiente', () => {
    estado.doc = remito({ origen: { tipo: 'pedido', id: 'o1', numero: 'PDV00010' } })
    estado.avance = AVANCE
    montar()

    const seccion = screen.getByRole('heading', { name: 'Avance del pedido' }).closest('section')!
    expect(within(seccion).getByRole('columnheader', { name: 'Ya entregado' })).toBeInTheDocument()
    expect(within(seccion).getByRole('columnheader', { name: 'Esta entrega' })).toBeInTheDocument()
    expect(within(seccion).getByRole('columnheader', { name: 'Pendiente después' })).toBeInTheDocument()
    expect(seccion).toHaveTextContent(/todavía no salió/)
  })

  it('sin pedido de origen no hay contra qué comparar: no se muestra', () => {
    estado.doc = remito({ origen: null })
    estado.avance = AVANCE
    montar()
    expect(screen.queryByRole('heading', { name: 'Avance del pedido' })).toBeNull()
  })

  it('con líneas sin enlazar NO inventa el reparto', () => {
    estado.doc = remito({ origen: { tipo: 'pedido', id: 'o1', numero: 'PDV00010' } })
    estado.avance = { lineas: [], sinEnlazar: 2, repartoDudoso: false }
    montar()
    expect(screen.getByText('Avance no reconstruido')).toBeInTheDocument()
    expect(screen.getByText(/No se calcula el avance por línea/)).toBeInTheDocument()
  })
})

/**
 * La hoja del remito, al lado del editor (Fase 26 · E2).
 *
 * Con una diferencia respecto de la cotización y el pedido: **la hoja del
 * remito no se edita.** Lo único editable de un remito es la cantidad, y tiene
 * tope contra lo pendiente del pedido; ese tope y la columna «pendiente
 * después» están en la tabla de la izquierda, y dejar escribir en la hoja sería
 * saltear la única pantalla que muestra contra qué se compara.
 */
describe('La hoja del remito', () => {
  const hoja = () => screen.queryByRole('region', { name: 'Documento' })

  it('con pantalla ancha aparece sola, con el remito adentro', async () => {
    estado.pantallaAncha = true
    montar()
    await waitFor(() => expect(hoja()).not.toBeNull())
    expect(within(hoja()!).getByText('RT00001321')).toBeInTheDocument()
  })

  it('con pantalla angosta no ocupa lugar, y el botón la muestra', async () => {
    estado.pantallaAncha = false
    montar()
    expect(hoja()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver documento' }))
    await waitFor(() => expect(hoja()).not.toBeNull())
  })

  it('nunca es un editor: no tiene el control de agregar producto', async () => {
    estado.pantallaAncha = true
    montar()
    await waitFor(() => expect(hoja()).not.toBeNull())
    expect(within(hoja()!).queryByRole('button', { name: /Agregar producto/ })).toBeNull()
  })
})
