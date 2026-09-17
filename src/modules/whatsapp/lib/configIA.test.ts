import { describe, expect, it } from 'vitest'
import {
  alertasIA,
  cambiosConfig,
  codigoDeError,
  erroresConfig,
  formularioDesdeConfig,
  modoDe,
  textoErrorConfig,
  textoErrorTrabajo,
  usd,
  type ConfigIA,
  type MetricasIA,
} from './configIA'
import { atajoPeriodo, periodoSemanal } from './ia'

const config = (p: Partial<ConfigIA> = {}): ConfigIA => ({
  companyId: 'c1',
  enabled: false,
  autoAnalyze: false,
  dailyReportEnabled: false,
  weeklyReportEnabled: false,
  dailyReportTime: null,
  weeklyReportDay: null,
  weeklyReportTime: null,
  debounceSeconds: 120,
  maxDailyAnalyses: null,
  maxDailyCostUsd: null,
  timezone: 'America/Argentina/Buenos_Aires',
  updatedAt: '2026-09-17T12:00:00Z',
  modo: 'desactivada',
  ...p,
})

const periodo = { corridas: 0, llamadas: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costoUsd: 0, errores: 0, omitidas: 0 }
const metricas = (p: Partial<MetricasIA> = {}): MetricasIA => ({
  hoy: periodo,
  ultimos7Dias: periodo,
  mes: periodo,
  cola: { pendientes: 0, procesando: 0, fallidos: 0, limiteAlcanzado: 0, cancelados: 0 },
  proveedor: { proveedor: 'openai', modelo: 'gpt-5.6-luna', ultimoOkEn: null, ultimoError: null, ultimoErrorEn: null, noDisponible: false },
  fallidos: [],
  ...p,
})

describe('modo', () => {
  it('apagada manda sobre automática: el kill switch gana', () => {
    expect(modoDe({ enabled: false, autoAnalyze: true })).toBe('desactivada')
    expect(modoDe({ enabled: true, autoAnalyze: false })).toBe('manual')
    expect(modoDe({ enabled: true, autoAnalyze: true })).toBe('automatica')
  })
})

describe('validación', () => {
  const base = formularioDesdeConfig(config())

  it('el default es válido', () => {
    expect(erroresConfig(base)).toEqual({})
  })

  it('debounce entre 30 y 3600', () => {
    expect(erroresConfig({ ...base, debounceSeconds: '10' }).debounceSeconds).toBeTruthy()
    expect(erroresConfig({ ...base, debounceSeconds: '3601' }).debounceSeconds).toBeTruthy()
    expect(erroresConfig({ ...base, debounceSeconds: 'dos' }).debounceSeconds).toBeTruthy()
    expect(erroresConfig({ ...base, debounceSeconds: '30' }).debounceSeconds).toBeUndefined()
  })

  it('límites: vacío es «sin límite»; negativos, cero y texto no', () => {
    expect(erroresConfig({ ...base, maxDailyAnalyses: '' })).toEqual({})
    expect(erroresConfig({ ...base, maxDailyAnalyses: '0' }).maxDailyAnalyses).toBeTruthy()
    expect(erroresConfig({ ...base, maxDailyAnalyses: '1.5' }).maxDailyAnalyses).toBeTruthy()
    expect(erroresConfig({ ...base, maxDailyCostUsd: '0,25' })).toEqual({})
    expect(erroresConfig({ ...base, maxDailyCostUsd: '-1' }).maxDailyCostUsd).toBeTruthy()
    expect(erroresConfig({ ...base, maxDailyCostUsd: '0' }).maxDailyCostUsd).toBeTruthy()
  })

  it('un informe habilitado exige su día y hora', () => {
    expect(erroresConfig({ ...base, dailyReportEnabled: true }).dailyReportTime).toBeTruthy()
    expect(erroresConfig({ ...base, dailyReportEnabled: true, dailyReportTime: '08:00' })).toEqual({})
    const semanal = erroresConfig({ ...base, weeklyReportEnabled: true })
    expect(semanal.weeklyReportDay).toBeTruthy()
    expect(semanal.weeklyReportTime).toBeTruthy()
    expect(erroresConfig({ ...base, dailyReportTime: '25:00' }).dailyReportTime).toBeTruthy()
  })
})

describe('cambios', () => {
  it('sólo lo que cambió, con los nombres y tipos de la RPC', () => {
    const inicial = formularioDesdeConfig(config())
    expect(cambiosConfig(inicial, inicial)).toEqual({})
    expect(cambiosConfig(inicial, { ...inicial, enabled: true, autoAnalyze: true, maxDailyCostUsd: '0,25', maxDailyAnalyses: '50' })).toEqual({
      enabled: true,
      auto_analyze: true,
      max_daily_cost_usd: 0.25,
      max_daily_analyses: 50,
    })
  })

  it('vaciar un límite lo quita (null)', () => {
    const inicial = formularioDesdeConfig(config({ maxDailyAnalyses: 50 }))
    expect(cambiosConfig(inicial, { ...inicial, maxDailyAnalyses: '' })).toEqual({ max_daily_analyses: null })
  })

  it('nunca manda proveedor, modelo ni zona horaria', () => {
    const inicial = formularioDesdeConfig(config())
    const todo = cambiosConfig(inicial, {
      ...inicial, enabled: true, autoAnalyze: true, debounceSeconds: '60', maxDailyAnalyses: '1', maxDailyCostUsd: '1',
      dailyReportEnabled: true, dailyReportTime: '08:00', weeklyReportEnabled: true, weeklyReportDay: '1', weeklyReportTime: '09:00',
    })
    expect(Object.keys(todo).some((k) => /model|provider|timezone|key/.test(k))).toBe(false)
  })
})

describe('textos', () => {
  it('los códigos de la base se leen del mensaje de PostgREST', () => {
    expect(codigoDeError('CONFLICTO_VERSION')).toBe('conflicto_version')
    expect(codigoDeError('algo SIN_PERMISO algo')).toBe('sin_permiso')
    expect(codigoDeError('otra cosa')).toBe('desconocido')
    expect(textoErrorConfig('conflicto_version')).toMatch(/Otra persona/)
    expect(textoErrorConfig('xx')).toMatch(/No se pudo/)
  })

  it('los errores de trabajos se dicen en palabras', () => {
    expect(textoErrorTrabajo('proveedor_auth')).toMatch(/credencial/)
    expect(textoErrorTrabajo('lock_vencido')).toMatch(/interrumpió/)
    expect(textoErrorTrabajo('limit_reached')).toMatch(/Límite/)
  })

  it('USD con los decimales que sirven', () => {
    expect(usd(0)).toBe('USD 0')
    expect(usd(0.000737)).toBe('USD 0.000737')
    expect(usd(0.25)).toBe('USD 0.2500')
    expect(usd(12.5)).toBe('USD 12.50')
  })
})

describe('indicadores', () => {
  it('sin nada que mirar, sin indicadores', () => {
    expect(alertasIA(metricas(), 'automatica')).toEqual([])
  })

  it('proveedor caído, límite, fallidos y pendientes', () => {
    const a = alertasIA(
      metricas({
        cola: { pendientes: 2, procesando: 1, fallidos: 1, limiteAlcanzado: 3, cancelados: 0 },
        proveedor: { proveedor: 'openai', modelo: 'gpt-5.6-luna', ultimoOkEn: null, ultimoError: 'proveedor_caido', ultimoErrorEn: 'x', noDisponible: true },
      }),
      'automatica',
    )
    expect(a.map((x) => x.clave)).toEqual(['proveedor', 'limite', 'fallidos', 'pendientes'])
    expect(a[0]!.tono).toBe('danger')
    expect(a[3]!.texto).toMatch(/^3 conversación/)
  })

  it('con la IA manual, los pendientes no se ofrecen como indicador', () => {
    expect(alertasIA(metricas({ cola: { pendientes: 2, procesando: 0, fallidos: 0, limiteAlcanzado: 0, cancelados: 0 } }), 'manual')).toEqual([])
  })
})

describe('atajos de período', () => {
  const jueves = '2026-09-17'
  it('hoy y ayer son diarios', () => {
    expect(atajoPeriodo('hoy', jueves)).toEqual({ vista: 'diario', dia: '2026-09-17' })
    expect(atajoPeriodo('ayer', jueves)).toEqual({ vista: 'diario', dia: '2026-09-16' })
  })
  it('la semana anterior es la de lunes a lunes previa a la actual', () => {
    expect(periodoSemanal(atajoPeriodo('semana_actual', jueves).dia).desde).toBe('2026-09-14T03:00:00.000Z')
    expect(periodoSemanal(atajoPeriodo('semana_anterior', jueves).dia).desde).toBe('2026-09-07T03:00:00.000Z')
  })
  it('un lunes: la semana anterior no se confunde con la actual', () => {
    expect(periodoSemanal(atajoPeriodo('semana_anterior', '2026-09-14').dia).desde).toBe('2026-09-07T03:00:00.000Z')
  })
})
