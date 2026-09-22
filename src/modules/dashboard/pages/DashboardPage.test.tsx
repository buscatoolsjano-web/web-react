// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * El Dashboard (Fase 21 · E2).
 *
 * Todo lo que lee viene de hooks que ya existen, así que se mockean enteros:
 * sin Supabase ni red. Lo que se prueba es lo que puede mentir en pantalla —un
 * mes a medias comparado contra uno entero, un +100 % sobre cero, monedas
 * sumadas, un número que lleva a una lista distinta— y qué ve cada rol.
 */
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
  atencion: Consulta
  cuentas: unknown[]
  bandeja: Consulta
  ultimos: { documentos: unknown[]; cargando: boolean; error: Error | null; parcial: boolean }
  porEntregar: { total: number; filas: unknown[] }
  documentos: { sent: { total: number; filas: unknown[] }; draft: { total: number; filas: unknown[] } }
}
const estado = vi.hoisted<Estado>(() => ({
  rol: 'admin',
  stel: false,
  pipeline: { isPending: false, error: null, data: null },
  actividad: { isPending: false, error: null, data: null },
  atencion: { isPending: false, error: null, data: null },
  cuentas: [{ id: 'a1' }],
  bandeja: { isPending: false, error: null, data: { total: 3, totalSinLeer: 2, filas: [] } },
  ultimos: { documentos: [], cargando: false, error: null, parcial: false },
  porEntregar: { total: 28, filas: [] },
  documentos: { sent: { total: 2, filas: [] }, draft: { total: 1, filas: [] } },
}))
const refetch = vi.hoisted(() => vi.fn())
const reintentar = vi.hoisted(() => vi.fn())

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ Empresa', rol: estado.rol, esInterno: true }, cargando: false }),
}))
vi.mock('@/modules/informes/services/actividad', () => ({
  ErrorInforme: class ErrorInforme extends Error {},
}))
vi.mock('@/modules/informes/hooks/useActividad', () => ({
  usePipeline: () => ({ ...estado.pipeline, isFetching: false, refetch }),
  useActividad: () => ({ ...estado.actividad, isFetching: false, refetch }),
}))
vi.mock('@/modules/dashboard/hooks/useDashboard', () => ({
  useAtencion: () => ({ ...estado.atencion, isFetching: false, refetch }),
  useUltimosDocumentos: () => ({ ...estado.ultimos, reintentar }),
}))
vi.mock('@/modules/emails/hooks/useEmails', () => ({
  useCuentas: () => ({ data: estado.cuentas, isPending: false }),
  useBandeja: () => ({ ...estado.bandeja, refetch }),
}))
vi.mock('@/modules/ventas/hooks/useAutoridadNumeracion', () => ({
  useAutoridadNumeracion: () => ({ stel: () => estado.stel, cargando: false }),
}))
vi.mock('@/modules/ventas/hooks/useDocumentos', () => ({
  // Los pedidos por entregar se piden con los MISMOS filtros que el listado
  // de destino, así que el mock distingue por el filtro y no por el tipo.
  useDocumentos: (_t: string, f: { estado: 'sent' | 'draft' | null; pendienteDeEntrega?: boolean }) => ({
    data: f.pendienteDeEntrega ? estado.porEntregar : estado.documentos[f.estado ?? 'sent'],
    isPending: false,
    error: null,
    isFetching: false,
    refetch,
  }),
}))

const { DashboardPage } = await import('./DashboardPage')

const cifra = (documentos: number, importe: number) => ({ documentos, importe, enRevision: 0 })

/** Los números reales de septiembre 2026, medidos en producción. */
const ACTIVIDAD = {
  actual: { desde: '2026-09-01', hasta: '2026-09-22', parcial: true },
  anterior: { desde: '2026-08-01', hasta: '2026-08-22', parcial: false },
  kpis: [
    {
      tipo: 'cotizaciones',
      documentosActual: 30,
      documentosAnterior: 24,
      enRevisionActual: 0,
      sinMonedaEnRevisionActual: 0,
      monedas: [
        { moneda: 'USD', actual: cifra(27, 90518.55), anterior: cifra(17, 63493.94), variacion: 42.56 },
        { moneda: 'ARS', actual: cifra(3, 3501735.15), anterior: cifra(7, 7795023.92), variacion: -55.08 },
        // El EUR existe en la historia y no tuvo movimiento este mes.
        { moneda: 'EUR', actual: cifra(0, 0), anterior: cifra(1, 500), variacion: -100 },
      ],
    },
    {
      tipo: 'pedidos',
      documentosActual: 22,
      documentosAnterior: 19,
      enRevisionActual: 0,
      sinMonedaEnRevisionActual: 0,
      monedas: [{ moneda: 'USD', actual: cifra(19, 25348.68), anterior: cifra(0, 0), variacion: null }],
    },
    { tipo: 'entregas', documentosActual: 0, documentosAnterior: 0, enRevisionActual: 0, sinMonedaEnRevisionActual: 0, monedas: [] },
  ],
  series: [
    {
      tipo: 'cotizaciones',
      monedas: ['USD', 'ARS'],
      meses: [
        { mes: '2026-08-01', porMoneda: { USD: cifra(17, 63493.94), ARS: cifra(7, 7795023.92) } },
        { mes: '2026-09-01', porMoneda: { USD: cifra(27, 90518.55) } },
      ],
    },
    { tipo: 'pedidos', monedas: ['USD'], meses: [{ mes: '2026-09-01', porMoneda: { USD: cifra(19, 25348.68) } }] },
    { tipo: 'entregas', monedas: [], meses: [] },
  ],
}

const PIPELINE = {
  abiertas: [
    { moneda: 'USD', documentos: 120, importe: 300000, aceptadas: 9, porAntiguedad: {} },
    { moneda: 'ARS', documentos: 34, importe: 8000000, aceptadas: 2, porAntiguedad: {} },
  ],
  pendientes: [{ moneda: 'USD', sinEntrega: { documentos: 20, importe: 700 }, parcial: { documentos: 8, importe: 300 } }],
}

const ATENCION = {
  total: 219,
  conNoVerificable: 20,
  documentos: [
    { id: 'd1', tipo: 'cotizacion', numero: 'COTI-T00123', fecha: '2026-09-18', activos: ['x'], noVerificables: [] },
    { id: 'd2', tipo: 'pedido', numero: 'PDV01320', fecha: '2026-09-17', activos: [], noVerificables: ['y'] },
  ],
}

const DOC = (tipo: string, numero: string, fecha: string, moneda: string, total: number, id = numero) => ({
  id, tipo, numero, fecha, clienteId: 'c', clienteNombre: 'Cliente X', titulo: null, moneda, total,
  estado: tipo === 'cotizacion' ? 'sent' : tipo === 'pedido' ? 'confirmed' : 'delivered',
  estadoSecundario: null, vendedor: null, serie: null, origen: null,
  necesitaRevision: false, motivosRevision: [], numeroFueraDeSerie: false,
})

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
  estado.atencion = { isPending: false, error: null, data: ATENCION }
  estado.cuentas = [{ id: 'a1' }]
  estado.bandeja = { isPending: false, error: null, data: { total: 3, totalSinLeer: 2, filas: [] } }
  estado.ultimos = {
    documentos: [DOC('entrega', 'RT-ERP00001', '2026-09-21', 'USD', 157.91), DOC('cotizacion', 'COTI-T00030', '2026-09-20', 'ARS', 235950)],
    cargando: false,
    error: null,
    parcial: false,
  }
  estado.documentos = { sent: { total: 2, filas: [] }, draft: { total: 1, filas: [] } }
  estado.porEntregar = { total: 28, filas: [] }
  refetch.mockClear()
  reintentar.mockClear()
})

describe('A · El período se dice, y se dice que está a medias', () => {
  it('mes, aviso de parcial y contra qué ventana se compara', () => {
    montar()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dashboard')
    expect(screen.getByText('Septiembre 2026')).toBeInTheDocument()
    expect(screen.getByText(/· Datos al 22 de septiembre/)).toBeInTheDocument()
    expect(screen.getByText('Se compara 1–22 de septiembre contra 1–22 de agosto')).toBeInTheDocument()
  })
})

describe('B · Situación del mes', () => {
  it('Cotizado es el protagonista y va primero', () => {
    montar()
    const titulos = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(titulos[0]).toBe('Cotizado')
    expect(titulos.slice(0, 3)).toEqual(['Cotizado', 'Pedidos', 'Entregado'])
  })

  it('una línea por moneda, sin ningún total entre monedas', () => {
    montar()
    const cotizado = screen.getByRole('region', { name: 'Cotizado' })
    expect(within(cotizado).getByText('USD 90.518,55')).toBeInTheDocument()
    expect(within(cotizado).getByText('ARS 3.501.735,15')).toBeInTheDocument()
    expect(within(cotizado).getByText('27 cotizaciones')).toBeInTheDocument()
    expect(within(cotizado).getByText('3 cotizaciones')).toBeInTheDocument()
    // 90.518 + 3.501.735 no existe como número.
    expect(cotizado.textContent).not.toMatch(/3\.592\.253|TOTAL/i)
  })

  it('el EUR no ocupa una línea si no tuvo movimiento este mes', () => {
    montar()
    expect(within(screen.getByRole('region', { name: 'Cotizado' })).queryByText(/EUR/)).toBeNull()
  })

  it('la comparación dice la dirección con flecha Y texto, no sólo color', () => {
    montar()
    const cotizado = screen.getByRole('region', { name: 'Cotizado' })
    expect(within(cotizado).getByText('Subió 42,6 % vs 1–22 de agosto')).toBeInTheDocument()
    expect(within(cotizado).getByText('Bajó 55,1 % vs 1–22 de agosto')).toBeInTheDocument()
  })

  it('el mes anterior en cero no inventa un +100 %', () => {
    montar()
    const pedidos = screen.getByRole('region', { name: 'Pedidos' })
    expect(within(pedidos).getByText(/Sin base de comparación/)).toBeInTheDocument()
    expect(pedidos.textContent).not.toMatch(/100|∞|Infinity|NaN/)
  })

  it('un tipo sin actividad lo dice con palabras, no con un cero', () => {
    montar()
    expect(within(screen.getByRole('region', { name: 'Entregado' })).getByText('Sin entregas en este período.')).toBeInTheDocument()
  })

  it('si falla la actividad, el bloque avisa y se puede reintentar', () => {
    estado.actividad = { isPending: false, error: new Error('x'), data: null }
    montar()
    const cotizado = screen.getByRole('region', { name: 'Cotizado' })
    fireEvent.click(within(cotizado).getByRole('button', { name: 'Reintentar' }))
    expect(refetch).toHaveBeenCalled()
    // Y el resto del Dashboard sigue en pie.
    expect(screen.getByRole('heading', { name: 'Atención hoy' })).toBeInTheDocument()
  })
})

describe('C · Atención hoy', () => {
  it('los números accionables, cada uno con su link filtrado', () => {
    montar()
    expect(screen.getByText('154')).toBeInTheDocument()
    // 28 sale del estado de cumplimiento del servidor —el mismo que filtra la
    // lista de destino—, no de lo entregado línea por línea.
    expect(screen.getByText('28')).toBeInTheDocument()
    expect(screen.getByText('219')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver las 143 pendientes/ })).toHaveAttribute('href', '/ventas/cotizaciones?estado=sent')
    expect(screen.getByRole('link', { name: /Ver pedidos pendientes/ })).toHaveAttribute('href', '/ventas/pedidos?pendiente=1')
    expect(screen.getByRole('link', { name: /Ver la bandeja/ })).toHaveAttribute('href', '/emails?estado=pendiente')
  })

  it('los no verificables se dicen aparte, no se suman al problema', () => {
    montar()
    expect(screen.getByText(/20 tienen algún motivo que no se puede verificar/)).toBeInTheDocument()
  })

  it('el número de revisión se puede abrir y cada documento lleva a su ficha', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: /Ver cuáles son/ }))
    expect(screen.getByRole('link', { name: /COTI-T00123/ })).toHaveAttribute('href', '/ventas/cotizaciones/d1')
    expect(screen.getByRole('link', { name: /PDV01320/ })).toHaveAttribute('href', '/ventas/pedidos/d2')
  })

  it('Mantenimiento NO aparece: 0 órdenes no es trabajo pendiente', () => {
    montar()
    // Se mira DENTRO de Atención: «Órdenes de servicio» sigue siendo un acceso
    // rápido del menú, y eso está bien; lo que no puede es contarse como
    // trabajo pendiente del día.
    const atencion = screen.getByRole('heading', { name: 'Atención hoy' }).closest('section')!
    expect(within(atencion).queryByText(/Órdenes de servicio/)).toBeNull()
    expect(within(atencion).queryByText(/stock crítico/i)).toBeNull()
    expect(within(atencion).queryByText(/historial/i)).toBeNull()
  })

  it('sin cuenta de correo, la tarjeta de Emails no existe', () => {
    estado.cuentas = []
    montar()
    expect(screen.queryByText('Emails pendientes')).toBeNull()
  })

  it('sin nada pendiente, lo dice en vez de mostrar cuatro ceros', () => {
    estado.pipeline = { isPending: false, error: null, data: { abiertas: [], pendientes: [] } }
    estado.atencion = { isPending: false, error: null, data: { total: 0, conNoVerificable: 0, documentos: [] } }
    estado.bandeja = { isPending: false, error: null, data: { total: 0, totalSinLeer: 0, filas: [] } }
    estado.porEntregar = { total: 0, filas: [] }
    montar()
    expect(screen.getByText(/Nada pendiente/)).toBeInTheDocument()
  })
})

describe('D · La evolución', () => {
  it('doce meses, una métrica y una moneda, con la escala escrita', () => {
    montar()
    expect(screen.getByRole('heading', { name: 'Evolución · últimos 12 meses' })).toBeInTheDocument()
    expect(screen.getByText(/Cotizado en USD · escala 0 — USD 90.518,55/)).toBeInTheDocument()
  })

  it('el selector de métrica cambia lo que se mira', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Pedidos' }))
    expect(screen.getByText(/Pedidos en USD · escala/)).toBeInTheDocument()
  })

  it('el selector de moneda no mezcla: elige una', () => {
    montar()
    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'ARS' } })
    expect(screen.getByText(/Cotizado en ARS · escala 0 — ARS 7.795.023,92/)).toBeInTheDocument()
  })

  it('«Ver los números» abre la tabla con mes, importe y documentos', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Ver los números' }))
    const tabla = screen.getByRole('table')
    expect(within(tabla).getByText('Septiembre 2026')).toBeInTheDocument()
    expect(within(tabla).getByText('USD 90.518,55')).toBeInTheDocument()
    expect(within(tabla).getByRole('columnheader', { name: 'Documentos' })).toBeInTheDocument()
  })

  it('una serie sin datos lo dice, no dibuja un gráfico vacío', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Entregado' }))
    expect(screen.getByText(/Sin entregas .*en los últimos 12 meses/)).toBeInTheDocument()
  })
})

describe('E · Últimos documentos', () => {
  it('no se llama actividad en vivo y no muestra horas', () => {
    montar()
    expect(screen.getByRole('heading', { name: 'Últimos documentos' })).toBeInTheDocument()
    const lista = screen.getByRole('heading', { name: 'Últimos documentos' }).closest('section')!
    expect(lista.textContent).not.toMatch(/\d{1,2}:\d{2}/)
    expect(lista.textContent).not.toMatch(/en vivo|tiempo real|hace \d/i)
  })

  it('cada documento abre su ficha real', () => {
    montar()
    expect(screen.getByRole('link', { name: /RT-ERP00001/ })).toHaveAttribute('href', '/ventas/entregas/RT-ERP00001')
    expect(screen.getByRole('link', { name: /COTI-T00030/ })).toHaveAttribute('href', '/ventas/cotizaciones/COTI-T00030')
  })

  it('cada importe con su moneda, sin convertir', () => {
    montar()
    const lista = screen.getByRole('heading', { name: 'Últimos documentos' }).closest('section')!
    expect(within(lista).getByText('USD 157,91')).toBeInTheDocument()
    expect(within(lista).getByText('ARS 235.950,00')).toBeInTheDocument()
  })

  it('si falla, el resto del Dashboard sigue funcionando', () => {
    estado.ultimos = { documentos: [], cargando: false, error: new Error('x'), parcial: false }
    montar()
    expect(screen.getByRole('region', { name: 'Cotizado' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Atención hoy' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(reintentar).toHaveBeenCalled()
  })

  it('sin documentos lo dice con palabras', () => {
    estado.ultimos = { documentos: [], cargando: false, error: null, parcial: false }
    montar()
    expect(screen.getByText('Todavía no hay documentos emitidos.')).toBeInTheDocument()
  })
})

describe('Por rol', () => {
  it('el vendedor ve lo suyo y no el panel de la empresa', () => {
    estado.rol = 'salesperson'
    montar()
    expect(screen.getByRole('heading', { name: 'Cotizaciones pendientes' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Atención hoy' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Cotizado' })).toBeNull()
    const accesos = within(screen.getByRole('heading', { name: 'Accesos rápidos' }).closest('section')!).getAllByRole('link')
    expect(accesos.map((a) => a.getAttribute('href'))).not.toContain('/informes')
  })

  it('técnico y cliente: sólo accesos, sin métricas inventadas', () => {
    for (const rol of ['technician', 'customer']) {
      estado.rol = rol
      const { unmount } = montar()
      expect(screen.queryByRole('heading', { name: 'Atención hoy' })).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Evolución · últimos 12 meses' })).toBeNull()
      expect(screen.getByRole('heading', { name: 'Accesos rápidos' })).toBeInTheDocument()
      unmount()
    }
  })

  it('el aviso de STEL sigue donde estaba', () => {
    estado.stel = true
    montar()
    expect(screen.getByText('STEL numera cotizaciones, pedidos y notas de entrega')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver numeración' })).toHaveAttribute('href', '/configuracion/numeracion')
  })
})
