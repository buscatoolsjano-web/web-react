// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ConfigIA, MetricasIA } from '../lib/configIA'
import type * as ServicioConfigIA from '../services/configIA'

/**
 * Configuración → WhatsApp · IA. Se mockean los hooks de datos y la RPC de
 * guardado; la validación, los textos y los indicadores son los de producción.
 */
interface EstadoConsulta {
  data: unknown
  isPending: boolean
  isError: boolean
  isFetching?: boolean
  error: Error | null
}

const estado = vi.hoisted((): {
  rol: string
  config: EstadoConsulta
  metricas: EstadoConsulta
  habilitados: boolean[]
  guardar: ReturnType<typeof vi.fn>
  reintentar: ReturnType<typeof vi.fn>
} => ({
  rol: 'admin',
  config: { data: undefined, isPending: false, isError: false, error: null },
  metricas: { data: undefined, isPending: false, isError: false, isFetching: false, error: null },
  habilitados: [],
  guardar: vi.fn(),
  reintentar: vi.fn(),
}))

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true, customerId: null } }),
}))
vi.mock('../hooks/useWhatsapp', () => ({
  clavesIA: { config: () => ['c'], metricas: () => ['m'], modo: () => ['mo'] },
  useConfigIA: (habilitado: boolean) => {
    estado.habilitados.push(habilitado)
    return { ...estado.config, refetch: vi.fn() }
  },
  useMetricasIA: () => ({ ...estado.metricas, refetch: vi.fn() }),
}))
vi.mock('../services/configIA', async () => {
  const real = await vi.importActual<typeof ServicioConfigIA>('../services/configIA')
  return { ...real, guardarConfigIA: estado.guardar, reintentarAnalisis: estado.reintentar }
})

const { ConfigIAWhatsappPage } = await import('./ConfigIAWhatsappPage')
const { ErrorConfigIA } = await import('../services/configIA')

const config = (p: Partial<ConfigIA> = {}): ConfigIA => ({
  companyId: 'c1', enabled: false, autoAnalyze: false, dailyReportEnabled: false, weeklyReportEnabled: false,
  dailyReportTime: null, weeklyReportDay: null, weeklyReportTime: null, debounceSeconds: 120,
  maxDailyAnalyses: null, maxDailyCostUsd: null, timezone: 'America/Argentina/Buenos_Aires',
  updatedAt: '2026-09-17T12:00:00Z', modo: 'desactivada', ...p,
})
const periodo = { corridas: 3, llamadas: 2, inputTokens: 2051, outputTokens: 639, reasoningTokens: 268, costoUsd: 0.001177, errores: 0, omitidas: 1 }
const metricas = (p: Partial<MetricasIA> = {}): MetricasIA => ({
  hoy: periodo, ultimos7Dias: periodo, mes: periodo,
  cola: { pendientes: 0, procesando: 0, fallidos: 0, limiteAlcanzado: 0, cancelados: 0 },
  proveedor: { proveedor: 'openai', modelo: 'gpt-5.6-luna', ultimoOkEn: null, ultimoError: null, ultimoErrorEn: null, noDisponible: false },
  fallidos: [], ...p,
})

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MemoryRouter>
        <ConfigIAWhatsappPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  estado.rol = 'admin'
  estado.config = { data: config(), isPending: false, isError: false, error: null }
  estado.metricas = { data: metricas(), isPending: false, isError: false, isFetching: false, error: null }
  estado.habilitados = []
  estado.guardar.mockReset()
  estado.reintentar.mockReset()
})

describe('Configuración → WhatsApp · IA', () => {
  it('employee, vendedor y técnico no la ven, y no se piden datos', () => {
    for (const rol of ['employee', 'salesperson', 'technician']) {
      estado.rol = rol
      estado.habilitados = []
      const { unmount } = montar()
      expect(screen.getByRole('heading', { level: 1, name: 'Sin acceso a la IA de WhatsApp' })).toBeInTheDocument()
      expect(estado.habilitados.every((h) => !h)).toBe(true)
      unmount()
    }
  })

  it('muestra el estado, el proveedor y el modelo, sin poder cambiarlos y sin claves', () => {
    const { container } = montar()
    expect(screen.getAllByText('IA desactivada').length).toBeGreaterThan(0)
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('gpt-5.6-luna')).toBeInTheDocument()
    expect(screen.getByText('America/Argentina/Buenos_Aires')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /modelo|proveedor/i })).toBeNull()
    expect(container.textContent).not.toMatch(/sk-|api[_ ]?key/i)
  })

  it('la automática exige la IA habilitada', () => {
    montar()
    expect(screen.getByRole('checkbox', { name: 'Analizar automáticamente conversaciones' })).toBeDisabled()
    fireEvent.click(screen.getByRole('switch', { name: 'Habilitar IA de WhatsApp' }))
    const auto = screen.getByRole('checkbox', { name: 'Analizar automáticamente conversaciones' })
    expect(auto).toBeEnabled()
    fireEvent.click(auto)
    expect(screen.getByText(/tiene costo/)).toBeInTheDocument()
  })

  it('valores inválidos se marcan y no se puede guardar', () => {
    montar()
    fireEvent.change(screen.getByLabelText(/Espera antes de analizar/), { target: { value: '5' } })
    expect(screen.getByText(/Entre 30 y 3600 segundos/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
  })

  it('guarda SÓLO lo que cambió, con la versión leída, y avisa el resultado', async () => {
    estado.guardar.mockResolvedValue({ config: config({ enabled: true, modo: 'manual', maxDailyAnalyses: 50 }), cancelados: 0 })
    montar()
    fireEvent.click(screen.getByRole('switch', { name: 'Habilitar IA de WhatsApp' }))
    fireEvent.change(screen.getByLabelText(/Límite de análisis por día/), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(estado.guardar).toHaveBeenCalledTimes(1))
    expect(estado.guardar).toHaveBeenCalledWith('c1', '2026-09-17T12:00:00Z', { enabled: true, max_daily_analyses: 50 })
    expect(await screen.findByText(/Cambios guardados\. IA manual\./)).toBeInTheDocument()
  })

  it('apagar la IA explica qué pasa antes de guardar', () => {
    estado.config = { data: config({ enabled: true, autoAnalyze: true, modo: 'automatica' }), isPending: false, isError: false, error: null }
    montar()
    fireEvent.click(screen.getByRole('switch', { name: 'Habilitar IA de WhatsApp' }))
    expect(screen.getByText(/se cancelan los pendientes/)).toBeInTheDocument()
    expect(screen.getByText(/WhatsApp sigue funcionando igual/)).toBeInTheDocument()
  })

  it('un conflicto de versión se dice en palabras', async () => {
    estado.guardar.mockRejectedValue(new ErrorConfigIA('conflicto_version'))
    montar()
    fireEvent.click(screen.getByRole('switch', { name: 'Habilitar IA de WhatsApp' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Otra persona guardó cambios/)
  })

  it('uso y costo por período, con análisis, tokens y USD', () => {
    montar()
    const hoy = screen.getByRole('heading', { name: 'Hoy' }).parentElement!
    expect(within(hoy).getByText('Análisis').nextElementSibling).toHaveTextContent('2')
    expect(within(hoy).getByText('Costo estimado').nextElementSibling).toHaveTextContent('USD 0.001177')
    expect(within(hoy).getByText('Tokens de entrada').nextElementSibling).toHaveTextContent('2.051')
    expect(screen.getByRole('heading', { name: 'Últimos 7 días' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mes actual' })).toBeInTheDocument()
  })

  it('indicadores de límite y fallidos; reintentar un fallido', async () => {
    estado.config = { data: config({ enabled: true, autoAnalyze: true, modo: 'automatica' }), isPending: false, isError: false, error: null }
    estado.metricas = {
      data: metricas({
        cola: { pendientes: 0, procesando: 0, fallidos: 1, limiteAlcanzado: 2, cancelados: 0 },
        fallidos: [{ conversacionId: 'cv9', contacto: 'ZZ Ana', error: 'proveedor_auth', intentos: 1, actualizadoEn: '2026-09-17T12:00:00Z' }],
      }),
      isPending: false, isError: false, isFetching: false, error: null,
    }
    estado.reintentar.mockResolvedValue(undefined)
    montar()
    const indicadores = screen.getByRole('list', { name: 'Indicadores' })
    expect(within(indicadores).getByText(/Límite diario alcanzado: 2/)).toBeInTheDocument()
    expect(within(indicadores).getByText(/1 análisis fallido/)).toBeInTheDocument()
    expect(screen.getByText(/rechazó la credencial/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ZZ Ana' })).toHaveAttribute('href', '/whatsapp?conversacion=cv9')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar el análisis de ZZ Ana' }))
    await waitFor(() => expect(estado.reintentar).toHaveBeenCalledWith('cv9'))
  })

  it('con la IA automática apagada, «Reintentar» no se ofrece activo', () => {
    estado.config = { data: config({ enabled: true, modo: 'manual' }), isPending: false, isError: false, error: null }
    estado.metricas = {
      data: metricas({ fallidos: [{ conversacionId: 'cv9', contacto: 'ZZ Ana', error: 'proveedor_caido', intentos: 4, actualizadoEn: '2026-09-17T12:00:00Z' }] }),
      isPending: false, isError: false, isFetching: false, error: null,
    }
    montar()
    expect(screen.getByRole('button', { name: 'Reintentar el análisis de ZZ Ana' })).toBeDisabled()
  })

  it('error de lectura de la configuración', () => {
    estado.config = { data: undefined, isPending: false, isError: true, error: new ErrorConfigIA('sin_permiso') }
    montar()
    expect(screen.getByText(/Sólo un administrador/)).toBeInTheDocument()
  })
})
