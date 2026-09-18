// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type * as ServicioCotizaciones from '../services/cotizaciones'
import type { DocumentoDetalle, LineaDocumento, Relacionados } from '../types'
import type { EventoAuditoria } from '../lib/trazabilidad'

/**
 * La cotización sobre el shell documental (Fase 15 E1).
 *
 * Se mockea el cliente de Supabase —no la lógica— para que los servicios se
 * puedan importar sin `.env` (ver `vitest.aislado.config.ts`), y se mockean los
 * hooks de datos. `editabilidad`, `ordenarLineas`, los totales, la autoridad y
 * los permisos son los de producción: si alguna acción cambiara su condición de
 * habilitación, estos tests se caen.
 */
const estado = vi.hoisted((): {
  rol: string
  stel: Record<string, boolean>
  doc: unknown
  relacionados: unknown
  eventos: unknown[]
  contactos: unknown[]
  tarifas: unknown[]
  vendedores: unknown[]
} => ({ rol: 'admin', stel: {}, doc: null, relacionados: null, eventos: [], contactos: [], tarifas: [], vendedores: [] }))
const espias = vi.hoisted(() => ({
  // Tipado con la firma real: sin eso `mock.calls[0]` es una tupla vacía y no
  // se puede afirmar nada sobre los argumentos.
  guardar: vi.fn(
    (
      _quoteId: string,
      _esperado: string,
      _cabecera: Record<string, string | number | null>,
      _lineas: Record<string, unknown>[],
    ) => Promise.resolve({ actualizadoEn: 'x', cambiosCabecera: 1, lineasTocadas: 0 }),
  ),
  convertir: vi.fn((_quoteId: string, _esperado: string | null) =>
    Promise.resolve({ id: 'o-nuevo', numero: 'PDV01330', total: 484, lineas: 1 }),
  ),
}))

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
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
  useTrazabilidad: () => ({ data: estado.eventos, isPending: false, error: null }),
  // Fase 15 E2: las opciones del editor.
  useContactos: () => ({ data: estado.contactos, isPending: false }),
  useTarifas: () => ({ data: estado.tarifas, isPending: false }),
  useVendedores: () => ({ data: estado.vendedores, isPending: false }),
}))
// El guardado es el único camino de escritura; se espía para probar que NO se
// llama hasta apretar «Guardar cambios».
vi.mock('../services/cotizaciones', async (real) => ({
  ...(await real<Record<string, unknown>>()),
  guardarCotizacion: espias.guardar,
}))
// Fase 15 · E4: la conversión a pedido es UNA transacción del servidor.
vi.mock('../services/pedidos', async (real) => ({
  ...(await real<Record<string, unknown>>()),
  convertirCotizacionEnPedido: espias.convertir,
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

const { CotizacionDetallePage } = await import('./CotizacionDetallePage')

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

const cotizacion = (p: Partial<DocumentoDetalle> = {}): DocumentoDetalle => ({
  id: 'q1',
  tipo: 'cotizacion',
  numero: 'COTI02558',
  numeroOriginal: 'COTI02558',
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
  estado: 'sent',
  estadoSecundario: null,
  vendedor: null,
  serie: 'COTI',
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
  esHistorico: true,
  externalSource: 'stel',
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

/**
 * Un data router de verdad (como el de la aplicación, `createHashRouter`): el
 * bloqueo de navegación con cambios sin guardar (Fase 15 · E3) usa
 * `useBlocker`, que sólo existe ahí.
 */
const montar = (ruta = '/ventas/cotizaciones/q1', extra?: React.ReactNode) => {
  const router = createMemoryRouter(
    [
      {
        path: '/ventas/cotizaciones/:id',
        element: (
          <>
            {extra}
            <CotizacionDetallePage />
          </>
        ),
      },
      { path: '/ventas/pedidos/:id', element: <p>detalle del pedido</p> },
    ],
    { initialEntries: [ruta] },
  )
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  estado.rol = 'admin'
  estado.stel = {}
  estado.doc = cotizacion()
  estado.relacionados = sinRelacionados
  estado.eventos = []
  estado.contactos = []
  estado.tarifas = []
  estado.vendedores = []
  espias.guardar.mockClear()
  espias.convertir.mockClear()
})

/**
 * Cotización → pedido (Fase 15 · E4).
 *
 * Antes eran cuatro escrituras desde el navegador; ahora es una sola llamada
 * que hereda el snapshot comercial aprobado. Lo que se prueba acá es el
 * contrato del botón: una llamada con el testigo, el motivo cuando no se
 * puede, y que la cotización no se toque.
 */
describe('Cotización · convertir en pedido', () => {
  it('convierte en UNA llamada, con el testigo de concurrencia, y abre el pedido', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Generar pedido' }))

    await waitFor(() => expect(espias.convertir).toHaveBeenCalledTimes(1))
    expect(espias.convertir.mock.calls[0]).toEqual(['q1', '2026-09-16T12:30:00.000Z'])
    // La cotización no se guarda ni cambia de estado al convertir.
    expect(espias.guardar).not.toHaveBeenCalled()
    expect(await screen.findByText('detalle del pedido', undefined, { timeout: 8000 })).toBeInTheDocument()
  })

  it('dos clics seguidos no generan dos pedidos', async () => {
    let resolver: (v: { id: string; numero: string; total: number; lineas: number }) => void = () => {}
    espias.convertir.mockImplementationOnce(
      () => new Promise((r) => { resolver = r }),
    )
    montar()
    const boton = screen.getByRole('button', { name: 'Generar pedido' })
    fireEvent.click(boton)
    await waitFor(() => expect(screen.getByRole('button', { name: /Generando/ })).toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /Generando/ }))

    expect(espias.convertir).toHaveBeenCalledTimes(1)
    resolver({ id: 'o-nuevo', numero: 'PDV01330', total: 484, lineas: 1 })
    expect(await screen.findByText('detalle del pedido', undefined, { timeout: 8000 })).toBeInTheDocument()
  })

  it('una cotización que ya tiene pedido no vuelve a convertirse', () => {
    estado.relacionados = {
      ...sinRelacionados,
      pedidos: [
        { tipo: 'pedido', id: 'o1', numero: 'PDV01321', fecha: '2026-09-16', estado: 'confirmed', moneda: 'ARS', total: 484 },
      ],
    }
    montar()
    const boton = screen.getByRole('button', { name: 'Ya tiene pedido' })
    expect(boton).toBeDisabled()
    fireEvent.click(boton)
    expect(espias.convertir).not.toHaveBeenCalled()
  })

  it('con la numeración de pedidos en STEL no se convierte, y se explica', () => {
    estado.stel = { sales_order: true }
    montar()
    const boton = screen.getByRole('button', { name: 'Generar pedido' })
    expect(boton).toBeDisabled()
    expect(boton).toHaveAccessibleDescription(/Emisión desde el ERP bloqueada/)
    fireEvent.click(boton)
    expect(espias.convertir).not.toHaveBeenCalled()
  })

  it('si el servidor rechaza la conversión, se dice en castellano y no se navega', async () => {
    const { FalloDeGuardado } = await vi.importActual<typeof ServicioCotizaciones>('../services/cotizaciones')
    espias.convertir.mockRejectedValueOnce(
      new FalloDeGuardado('PEDIDO_YA_EXISTE', 'Esta cotización ya tiene un pedido.'),
    )
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Generar pedido' }))

    expect(await screen.findByText('Esta cotización ya tiene un pedido.')).toBeInTheDocument()
    expect(screen.queryByText('detalle del pedido')).not.toBeInTheDocument()
  })
})

describe('Cotización · shell documental', () => {
  it('abre mostrando identidad, acciones y las cinco pestañas, con Líneas primero', () => {
    montar()

    expect(screen.getByRole('heading', { level: 1, name: 'COTI02558' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText('Consulta MercadoLibre')).toBeInTheDocument()
    // El total está arriba y en el pie de las líneas: las dos son la misma cifra.
    expect(screen.getAllByText('ARS 484,00').length).toBeGreaterThan(0)

    const pestanas = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(pestanas).toEqual(['Líneas1', 'Información', 'Adjuntos', 'Relacionados', 'Trazabilidad'])
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

  it('el origen se muestra como dato, no como alerta', () => {
    montar()
    expect(screen.getAllByText('Migrado desde STEL').length).toBeGreaterThan(0)
    // No es un Alert: el documento migrado es normal, no un problema.
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('un documento del ERP dice que se emitió acá', () => {
    estado.doc = cotizacion({ esHistorico: false, externalSource: null })
    montar()
    expect(screen.getByText('Emitido en el ERP')).toBeInTheDocument()
  })
})

describe('Cotización · acciones', () => {
  it('con autoridad ERP la acción principal está a la vista y habilitada', () => {
    montar()
    const generar = screen.getByRole('button', { name: 'Generar pedido' })
    expect(generar).toBeEnabled()
    expect(generar).toBeVisible()
  })

  it('en borrador la principal es enviar, y generar el pedido sigue disponible', () => {
    estado.doc = cotizacion({ estado: 'draft' })
    montar()
    expect(screen.getByRole('button', { name: 'Marcar como enviada' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Generar pedido' })).toBeEnabled()
  })

  it('con autoridad STEL la acción se ve deshabilitada y con el motivo, no escondida', () => {
    estado.stel = { quote: true, sales_order: true }
    montar()

    const generar = screen.getByRole('button', { name: 'Generar pedido' })
    expect(generar).toBeVisible()
    expect(generar).toBeDisabled()
    expect(generar).toHaveAccessibleDescription(/Emisión desde el ERP bloqueada/)
    expect(screen.getByRole('button', { name: 'Marcar aceptada' })).toBeDisabled()
  })

  it('el bloqueo de autoridad se cuenta UNA vez por pantalla', () => {
    estado.stel = { quote: true, sales_order: true }
    montar()
    expect(screen.getAllByTestId('aviso-autoridad-stel')).toHaveLength(1)
    expect(screen.getAllByText(/Emisión desde el ERP bloqueada/)).toHaveLength(1)
  })

  it('«Marcar rechazada» vive en «Más», y la principal nunca', () => {
    montar()
    expect(screen.queryByRole('button', { name: 'Marcar rechazada' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Más/ }))
    expect(screen.getByRole('button', { name: 'Marcar rechazada' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Generar pedido' })).toBeVisible()
  })

  it('una cotización cerrada no ofrece editar y lo explica una sola vez', () => {
    estado.doc = cotizacion({ estado: 'accepted' })
    montar()

    expect(screen.getByText('Cerrada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
    expect(screen.getAllByText('La cotización está cerrada y no se puede modificar.')).toHaveLength(1)
  })

  it('quien no escribe no ve acciones de escritura', () => {
    estado.rol = 'salesperson'
    montar()
    for (const nombre of ['Generar pedido', 'Editar', 'Marcar aceptada', 'Eliminar']) {
      expect(screen.queryByRole('button', { name: nombre })).toBeNull()
    }
    expect(screen.getByRole('button', { name: 'Ver / Imprimir' })).toBeInTheDocument()
  })

  it('Editar abre el modo edición con Guardar y Descartar, y nada más', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))

    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument()
    // Las acciones incompatibles con un borrador a medias no se ofrecen.
    for (const nombre of ['Generar pedido', 'Marcar aceptada', 'Duplicar', 'Ver / Imprimir', 'Eliminar']) {
      expect(screen.queryByRole('button', { name: nombre })).toBeNull()
    }
  })

  it('sin cambios, Guardar está apagado', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
    expect(screen.getByText(/Sin cambios todavía/)).toBeInTheDocument()
  })

  it('NO se escribe nada hasta apretar Guardar', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))

    const titulo = screen.getByLabelText(/Título/)
    fireEvent.change(titulo, { target: { value: 'ZZ nuevo título' } })

    // El corazón de E2: se editó, y la base no se tocó.
    expect(espias.guardar).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled()
    expect(screen.getByText(/Hay cambios sin guardar/)).toBeInTheDocument()
  })

  it('Guardar manda UNA sola llamada, con el testigo de concurrencia', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    fireEvent.change(screen.getByLabelText(/Título/), { target: { value: 'ZZ nuevo título' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    // La mutación es asíncrona: la llamada llega después del clic.
    await waitFor(() => expect(espias.guardar).toHaveBeenCalledTimes(1))
    const [quoteId, esperado, cabecera] = espias.guardar.mock.calls[0]!
    expect(quoteId).toBe('q1')
    expect(esperado).toBe('2026-09-16T12:30:00.000Z')
    expect(cabecera).toEqual({ title: 'ZZ nuevo título' })
  })

  it('Descartar con cambios pide confirmación y no escribe', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    fireEvent.change(screen.getByLabelText(/Título/), { target: { value: 'ZZ otro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))

    expect(screen.getByRole('alertdialog', { name: 'Hay cambios sin guardar' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Descartar cambios' }))

    expect(espias.guardar).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
  })

  it('irse a otra cotización con cambios PREGUNTA antes de perder el borrador', async () => {
    montar('/ventas/cotizaciones/q1', <Link to="/ventas/cotizaciones/q2">ir a otra</Link>)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    fireEvent.change(screen.getByLabelText(/Título/), { target: { value: 'ZZ borrador de q1' } })

    // Primer intento: se frena y se explica.
    fireEvent.click(screen.getByRole('link', { name: 'ir a otra' }))
    const dialogo = await screen.findByRole('alertdialog', { name: 'Hay cambios sin guardar' })
    expect(within(dialogo).getByText(/los cambios que hiciste se van a perder/)).toBeInTheDocument()

    // «Seguir editando»: se queda y el borrador sigue.
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Seguir editando' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText(/Título/)).toHaveValue('ZZ borrador de q1')
    expect(espias.guardar).not.toHaveBeenCalled()

    // «Descartar y salir»: recién ahí se navega.
    fireEvent.click(screen.getByRole('link', { name: 'ir a otra' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Descartar y salir' }))

    // El documento nuevo abre en lectura, sin el borrador del anterior.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
    expect(espias.guardar).not.toHaveBeenCalled()
  })

  it('con la edición cerrada, navegar no pregunta nada', async () => {
    montar('/ventas/cotizaciones/q1', <Link to="/ventas/cotizaciones/q2">ir a otra</Link>)
    fireEvent.click(screen.getByRole('link', { name: 'ir a otra' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('editar sin tocar nada tampoco pregunta: no hay cambios que perder', async () => {
    montar('/ventas/cotizaciones/q1', <Link to="/ventas/cotizaciones/q2">ir a otra</Link>)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('link', { name: 'ir a otra' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('cambiar de pestaña NO descarta el borrador ni pregunta', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    fireEvent.change(screen.getByLabelText(/Título/), { target: { value: 'ZZ sobrevive' } })

    fireEvent.click(screen.getByRole('tab', { name: /Líneas/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))

    expect(screen.getByLabelText(/Título/)).toHaveValue('ZZ sobrevive')
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled()
  })
})

describe('Cotización · pestañas', () => {
  it('Información muestra lo que falta como faltante, y la tarifa vacía se dice así', () => {
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))

    expect(screen.getByText('Sin contacto asignado')).toBeInTheDocument()
    // Vendedor y forma de pago: decisiones de negocio tomadas, hoy vacías.
    expect(screen.getAllByText('Sin registrar').length).toBeGreaterThanOrEqual(2)
    // Fase 15 · E2: el documento sí guarda su tarifa. Sin ella, se dice que
    // no quedó registrada, que no es lo mismo que inferir la del cliente.
    expect(screen.getByText('Tarifa')).toBeInTheDocument()
    expect(screen.getByText('Sin tarifa registrada')).toBeInTheDocument()
    // Una vez como badge en la cabecera y otra como dato en Información.
    expect(screen.getAllByText(/Migrado desde STEL/).length).toBeGreaterThan(0)
  })

  it('con tarifa registrada, Información muestra su nombre (Fase 15 E2)', () => {
    estado.doc = cotizacion({ listaPrecioId: 'pl1', listaPrecioNombre: 'Mayorista' })
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))

    expect(screen.getByText('Mayorista')).toBeInTheDocument()
    expect(screen.queryByText('Sin tarifa registrada')).toBeNull()
  })

  it('Información muestra el contacto con sus datos cuando existe', () => {
    estado.doc = cotizacion({
      contactoNombre: 'Ana Pérez',
      contactoRol: 'Compras',
      contactoEmail: 'ana@ejemplo.com',
      contactoTelefono: null,
    })
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))
    expect(screen.getByText(/Ana Pérez/)).toBeInTheDocument()
    expect(screen.getByText(/Compras · ana@ejemplo.com/)).toBeInTheDocument()
  })

  it('Adjuntos dice que no hay, sin prometer nada más', async () => {
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Adjuntos' }))
    expect(await screen.findByText('Sin archivos adjuntos.')).toBeInTheDocument()
  })

  it('Relacionados muestra la cadena real y no inventa facturas ni cobranzas', () => {
    estado.relacionados = {
      ...sinRelacionados,
      pedidos: [
        { tipo: 'pedido', id: 'p1', numero: 'PDV01321', fecha: '2026-09-16', estado: 'confirmed', moneda: 'ARS', total: 484 },
      ],
    }
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Relacionados' }))

    expect(screen.getByRole('link', { name: /PDV01321/ })).toHaveAttribute('href', '/ventas/pedidos/p1')
    expect(screen.getByRole('heading', { name: 'Entregas' })).toBeInTheDocument()
    // Facturas y cobranzas no existen todavía como documento: no se dibuja su hueco.
    expect(screen.queryByRole('heading', { name: 'Facturas' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Cobranzas' })).toBeNull()
  })

  it('Trazabilidad cuenta los hechos en castellano, sin ids ni JSON', () => {
    const eventos: EventoAuditoria[] = [
      {
        id: 7,
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
    expect(screen.queryByText(/q1/)).toBeNull()
  })

  it('Trazabilidad sin eventos explica qué se registra', () => {
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Trazabilidad' }))
    expect(screen.getByText(/Todavía no hay cambios registrados/)).toBeInTheDocument()
  })

  it('un enlace con la pestaña abre directo en esa pestaña', () => {
    montar('/ventas/cotizaciones/q1?tab=relacionados')
    expect(screen.getByRole('tab', { name: 'Relacionados' })).toHaveAttribute('aria-selected', 'true')
  })
})
