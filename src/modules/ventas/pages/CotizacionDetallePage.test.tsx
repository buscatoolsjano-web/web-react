// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
} => ({ rol: 'admin', stel: {}, doc: null, relacionados: null, eventos: [] }))

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
}))
vi.mock('../services/adjuntos', () => ({
  listarAdjuntos: () => Promise.resolve([]),
  subirAdjunto: vi.fn(),
  borrarAdjunto: vi.fn(),
  urlDeDescarga: vi.fn(),
  formatearBytes: (n: number) => `${n} B`,
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

const montar = (ruta = '/ventas/cotizaciones/q1') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/ventas/cotizaciones/:id" element={<CotizacionDetallePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  estado.rol = 'admin'
  estado.stel = {}
  estado.doc = cotizacion()
  estado.relacionados = sinRelacionados
  estado.eventos = []
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

  it('editar sigue guardando al salir del campo, y la pantalla no promete un Descartar que no existe', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))

    expect(screen.getByText(/Los cambios se guardan solos al salir de cada campo/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Descartar/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Terminar edición' })).toBeInTheDocument()
  })
})

describe('Cotización · pestañas', () => {
  it('Información muestra lo que falta como faltante y no inventa la tarifa', () => {
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Información' }))

    expect(screen.getByText('Sin contacto asignado')).toBeInTheDocument()
    // Vendedor y forma de pago: decisiones de negocio tomadas, hoy vacías.
    expect(screen.getAllByText('Sin registrar').length).toBeGreaterThanOrEqual(2)
    // La tarifa no se persiste en el documento: no se muestra nada inferido.
    expect(screen.queryByText('Tarifa')).toBeNull()
    // Una vez como badge en la cabecera y otra como dato en Información.
    expect(screen.getAllByText(/Migrado desde STEL/).length).toBeGreaterThan(0)
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
