// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Todo lo que el Inicio lee viene de hooks que ya existen: se mockean enteros
// (sin Supabase ni red). El test mira qué ve cada rol y cómo se presenta.
interface Consulta {
  isPending: boolean
  error: Error | null
  data: unknown
}
interface Estado {
  rol: string
  stel: boolean
  pipeline: Consulta
  actividad: Consulta
  ordenes: Consulta
  cuentas: unknown[]
  bandeja: Consulta
  documentos: { sent: { total: number; filas: unknown[] }; draft: { total: number; filas: unknown[] } }
}
const estado = vi.hoisted<Estado>(() => ({
  rol: 'admin',
  stel: false,
  pipeline: { isPending: false, error: null, data: null },
  actividad: { isPending: false, error: null, data: null },
  ordenes: { isPending: false, error: null, data: { total: 4, filas: [] } },
  cuentas: [{ id: 'a1' }],
  bandeja: { isPending: false, error: null, data: { total: 3, totalSinLeer: 2, filas: [] } },
  documentos: { sent: { total: 2, filas: [] }, draft: { total: 1, filas: [] } },
}))
const refetch = vi.hoisted(() => vi.fn())

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ Empresa', rol: estado.rol, esInterno: true }, cargando: false }),
}))
vi.mock('@/modules/informes/services/actividad', () => ({
  ErrorInforme: class ErrorInforme extends Error {
    constructor(readonly codigo: string, mensaje: string) {
      super(mensaje)
    }
  },
}))
vi.mock('@/modules/informes/hooks/useActividad', () => ({
  usePipeline: () => ({ ...estado.pipeline, isFetching: false, refetch }),
  useActividad: () => ({ ...estado.actividad, isFetching: false, refetch }),
}))
vi.mock('@/modules/mantenimiento/hooks/useOrdenes', () => ({ useOrdenes: () => ({ ...estado.ordenes, refetch }) }))
vi.mock('@/modules/emails/hooks/useEmails', () => ({
  useCuentas: () => ({ data: estado.cuentas, isPending: false }),
  useBandeja: () => ({ ...estado.bandeja, refetch }),
}))
vi.mock('@/modules/ventas/hooks/useAutoridadNumeracion', () => ({
  useAutoridadNumeracion: () => ({ stel: () => estado.stel, cargando: false }),
}))
vi.mock('@/modules/ventas/hooks/useDocumentos', () => ({
  useDocumentos: (_tipo: string, f: { estado: 'sent' | 'draft' }) => ({ data: estado.documentos[f.estado], isPending: false, error: null, isFetching: false, refetch }),
}))

const { DashboardPage } = await import('./DashboardPage')

const PIPELINE = {
  abiertas: [
    { moneda: 'USD', documentos: 2, importe: 1500, aceptadas: 1, porAntiguedad: {} },
    { moneda: 'SIN MONEDA', documentos: 1, importe: 80, aceptadas: 0, porAntiguedad: {} },
    { moneda: 'ARS', documentos: 1, importe: 250000, aceptadas: 0, porAntiguedad: {} },
  ],
  pendientes: [{ moneda: 'USD', sinEntrega: { documentos: 1, importe: 700 }, parcial: { documentos: 1, importe: 300 } }],
}
const cifra = (documentos: number, importe: number) => ({ documentos, importe, enRevision: 0 })
const ACTIVIDAD = {
  kpis: [
    { tipo: 'cotizaciones', documentosActual: 3, documentosAnterior: 0, enRevisionActual: 2, sinMonedaEnRevisionActual: 1, monedas: [{ moneda: 'USD', actual: cifra(3, 900), anterior: cifra(0, 0), variacion: null }] },
    { tipo: 'pedidos', documentosActual: 1, documentosAnterior: 0, enRevisionActual: 0, sinMonedaEnRevisionActual: 0, monedas: [{ moneda: 'EUR', actual: cifra(1, 50), anterior: cifra(0, 0), variacion: null }] },
    { tipo: 'entregas', documentosActual: 0, documentosAnterior: 0, enRevisionActual: 0, sinMonedaEnRevisionActual: 0, monedas: [] },
  ],
}
const VACIO_PIPELINE = { abiertas: [], pendientes: [] }
const VACIA_ACTIVIDAD = { kpis: ACTIVIDAD.kpis.map((k) => ({ ...k, documentosActual: 0, enRevisionActual: 0, sinMonedaEnRevisionActual: 0, monedas: [] })) }

const montar = () =>
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  estado.rol = 'admin'
  estado.stel = false
  estado.pipeline = { isPending: false, error: null, data: PIPELINE }
  estado.actividad = { isPending: false, error: null, data: ACTIVIDAD }
  estado.ordenes = { isPending: false, error: null, data: { total: 4, filas: [] } }
  estado.cuentas = [{ id: 'a1' }]
  estado.bandeja = { isPending: false, error: null, data: { total: 3, totalSinLeer: 2, filas: [] } }
  estado.documentos = { sent: { total: 2, filas: [] }, draft: { total: 1, filas: [] } }
  refetch.mockClear()
})

describe('Inicio por rol', () => {
  it('admin: un solo h1, métricas operativas y accesos del menú', () => {
    montar()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Inicio')
    expect(screen.getByText('ZZ Empresa · Administrador')).toBeInTheDocument()
    for (const t of ['Cotizaciones abiertas', 'Pedidos por entregar', 'Órdenes de servicio abiertas', 'Emails pendientes']) {
      expect(screen.getByRole('heading', { name: t })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'Configuración' })).toHaveAttribute('href', '/configuracion')
    expect(screen.getByRole('link', { name: /Informes/ })).toBeInTheDocument()
    // Nunca la pantalla de verificación de la Fase 1.
    expect(document.body.textContent).not.toMatch(/Conexión a Supabase|Cliente Demo/)
  })

  it('importes por moneda, separados, sin total general y SIN MONEDA al final', () => {
    montar()
    const tarjeta = screen.getByRole('heading', { name: 'Cotizaciones abiertas' }).closest('article')!
    expect(within(tarjeta).getByText('4')).toBeInTheDocument()
    const monedas = within(within(tarjeta).getByRole('list', { name: 'Importe abierto por moneda' })).getAllByRole('listitem')
    expect(monedas.map((li) => li.textContent)).toEqual(['USD1.500,00', 'ARS250.000,00', 'SIN MONEDA80,00'])
    // Ninguna suma entre monedas.
    expect(tarjeta.textContent).not.toMatch(/251\.580|TOTAL/i)
  })

  it('singular y plural en las métricas', () => {
    estado.ordenes = { isPending: false, error: null, data: { total: 1, filas: [] } }
    montar()
    const ordenes = screen.getByRole('heading', { name: 'Órdenes de servicio abiertas' }).closest('article')!
    expect(ordenes).toHaveTextContent('1 orden')
    expect(ordenes).not.toHaveTextContent('1 órdenes')
    expect(screen.getByText('1 pedido')).toBeInTheDocument()
  })

  it('alertas reales: STEL y documentos del mes a revisar', () => {
    estado.stel = true
    montar()
    expect(screen.getByText('STEL numera cotizaciones, pedidos y notas de entrega')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver numeración' })).toHaveAttribute('href', '/configuracion/numeracion')
    expect(screen.getByText('2 documentos del mes requieren atención')).toBeInTheDocument()
    expect(screen.getByText(/1 no tiene moneda/)).toBeInTheDocument()
  })

  it('sin cuenta de correo no se muestra la métrica de Emails', () => {
    estado.cuentas = []
    montar()
    expect(screen.queryByRole('heading', { name: 'Emails pendientes' })).toBeNull()
  })

  it('empresa sin actividad: mensaje útil en lugar de ceros, con accesos', () => {
    estado.pipeline = { isPending: false, error: null, data: VACIO_PIPELINE }
    estado.actividad = { isPending: false, error: null, data: VACIA_ACTIVIDAD }
    estado.ordenes = { isPending: false, error: null, data: { total: 0, filas: [] } }
    estado.bandeja = { isPending: false, error: null, data: { total: 0, totalSinLeer: 0, filas: [] } }
    montar()
    expect(screen.getByText('Aún no hay actividad registrada')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Cotizaciones abiertas' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Accesos rápidos' })).toBeInTheDocument()
  })

  it('cargando: skeleton, nunca un 0 inventado; error: mensaje y Reintentar', () => {
    estado.pipeline = { isPending: true, error: null, data: null }
    const { unmount } = montar()
    expect(screen.getByRole('status', { name: 'Cargando cotizaciones abiertas…' })).toBeInTheDocument()
    expect(screen.queryByText('Aún no hay actividad registrada')).toBeNull()
    unmount()
    estado.pipeline = { isPending: false, error: new Error('x'), data: null }
    montar()
    const tarjeta = screen.getByRole('heading', { name: 'Cotizaciones abiertas' }).closest('article')!
    expect(within(tarjeta).getByRole('alert')).toHaveTextContent('No se pudo leer este dato.')
    fireEvent.click(within(tarjeta).getByRole('button', { name: 'Reintentar' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('vendedor: sus cotizaciones y sólo los accesos que su menú ofrece', () => {
    estado.rol = 'salesperson'
    montar()
    expect(screen.getByRole('heading', { name: 'Cotizaciones pendientes' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Borradores' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Órdenes de servicio abiertas' })).toBeNull()
    const accesos = within(screen.getByRole('heading', { name: 'Accesos rápidos' }).closest('section')!).getAllByRole('link')
    const destinos = accesos.map((a) => a.getAttribute('href'))
    expect(destinos).toContain('/ventas/cotizaciones')
    expect(destinos).not.toContain('/compras/pedidos')
    expect(destinos).not.toContain('/configuracion')
    expect(destinos).not.toContain('/informes')
  })

  it('técnico y cliente: sólo accesos rápidos, sin métricas inventadas', () => {
    for (const rol of ['technician', 'customer']) {
      estado.rol = rol
      const { unmount } = montar()
      expect(screen.queryByRole('article')).toBeNull()
      expect(screen.getByRole('heading', { name: 'Accesos rápidos' })).toBeInTheDocument()
      unmount()
    }
  })
})
