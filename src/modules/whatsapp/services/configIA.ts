import { supabase } from '@/services/supabase/client'
import { codigoDeError, type ConfigIA, type MetricasIA, type MetricasPeriodo, type ModoIA } from '../lib/configIA'

/**
 * Configuración, estado y métricas de la IA de WhatsApp (Fase 16 · E3).
 *
 * Todo pasa por RPC: la base valida el rol (admin para configurar y ver
 * métricas; cualquiera con WhatsApp para saber el modo), los valores y la
 * versión. El navegador no decide nada de eso ni ve claves de ningún proveedor.
 */

export class ErrorConfigIA extends Error {
  readonly codigo: string
  constructor(codigo: string) {
    super(codigo)
    this.codigo = codigo
    this.name = 'ErrorConfigIA'
  }
}

interface FilaConfig {
  company_id: string
  enabled: boolean
  auto_analyze: boolean
  daily_report_enabled: boolean
  weekly_report_enabled: boolean
  daily_report_time: string | null
  weekly_report_day: number | null
  weekly_report_time: string | null
  analysis_debounce_seconds: number
  max_daily_analyses: number | null
  max_daily_cost_usd: number | string | null
  timezone: string
  updated_at: string | null
  modo: ModoIA
  trabajos_cancelados?: number
}

export function aConfig(f: FilaConfig): ConfigIA {
  return {
    companyId: f.company_id,
    enabled: f.enabled,
    autoAnalyze: f.auto_analyze,
    dailyReportEnabled: f.daily_report_enabled,
    weeklyReportEnabled: f.weekly_report_enabled,
    dailyReportTime: f.daily_report_time,
    weeklyReportDay: f.weekly_report_day,
    weeklyReportTime: f.weekly_report_time,
    debounceSeconds: f.analysis_debounce_seconds,
    maxDailyAnalyses: f.max_daily_analyses,
    maxDailyCostUsd: f.max_daily_cost_usd === null ? null : Number(f.max_daily_cost_usd),
    timezone: f.timezone,
    updatedAt: f.updated_at,
    modo: f.modo,
  }
}

const fallo = (mensaje: string) => new ErrorConfigIA(codigoDeError(mensaje))

export async function obtenerConfigIA(companyId: string): Promise<ConfigIA> {
  const { data, error } = await supabase.rpc('config_ia_whatsapp', { p_company: companyId })
  if (error) throw fallo(error.message)
  return aConfig(data as unknown as FilaConfig)
}

export async function guardarConfigIA(
  companyId: string,
  version: string | null,
  cambios: Record<string, boolean | number | string | null>,
): Promise<{ config: ConfigIA; cancelados: number }> {
  const { data, error } = await supabase.rpc('guardar_config_ia_whatsapp', {
    p_company: companyId,
    // La RPC acepta null («sin versión leída»); los tipos generados no lo dicen.
    p_version: version as string,
    p_config: cambios,
  })
  if (error) throw fallo(error.message)
  const f = data as unknown as FilaConfig
  return { config: aConfig(f), cancelados: f.trabajos_cancelados ?? 0 }
}

/** El modo, para cualquiera que use WhatsApp. Sin detalles de límites ni costos. */
export async function obtenerModoIA(companyId: string): Promise<ModoIA> {
  const { data, error } = await supabase.rpc('estado_ia_whatsapp', { p_company: companyId })
  if (error) throw fallo(error.message)
  return (data as unknown as { modo: ModoIA }).modo
}

interface FilaPeriodo {
  corridas: number
  llamadas: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  costo_usd: number | string
  errores: number
  omitidas: number
}

interface FilaMetricas {
  periodos: Record<'hoy' | 'ultimos_7_dias' | 'mes', FilaPeriodo>
  cola: { pendientes: number; procesando: number; fallidos: number; limite_alcanzado: number; cancelados: number }
  proveedor: {
    proveedor: string | null; modelo: string | null; ultimo_ok_en: string | null
    ultimo_error: string | null; ultimo_error_en: string | null; no_disponible: boolean
  }
  fallidos: { conversation_id: string; contacto: string; error: string | null; intentos: number; actualizado_en: string }[]
}

const periodo = (p: FilaPeriodo | undefined): MetricasPeriodo => ({
  corridas: Number(p?.corridas ?? 0),
  llamadas: Number(p?.llamadas ?? 0),
  inputTokens: Number(p?.input_tokens ?? 0),
  outputTokens: Number(p?.output_tokens ?? 0),
  reasoningTokens: Number(p?.reasoning_tokens ?? 0),
  costoUsd: Number(p?.costo_usd ?? 0),
  errores: Number(p?.errores ?? 0),
  omitidas: Number(p?.omitidas ?? 0),
})

export function aMetricas(f: FilaMetricas): MetricasIA {
  return {
    hoy: periodo(f.periodos?.hoy),
    ultimos7Dias: periodo(f.periodos?.ultimos_7_dias),
    mes: periodo(f.periodos?.mes),
    cola: {
      pendientes: f.cola.pendientes,
      procesando: f.cola.procesando,
      fallidos: f.cola.fallidos,
      limiteAlcanzado: f.cola.limite_alcanzado,
      cancelados: f.cola.cancelados,
    },
    proveedor: {
      proveedor: f.proveedor.proveedor,
      modelo: f.proveedor.modelo,
      ultimoOkEn: f.proveedor.ultimo_ok_en,
      ultimoError: f.proveedor.ultimo_error,
      ultimoErrorEn: f.proveedor.ultimo_error_en,
      noDisponible: f.proveedor.no_disponible,
    },
    fallidos: f.fallidos.map((x) => ({
      conversacionId: x.conversation_id,
      contacto: x.contacto,
      error: x.error,
      intentos: x.intentos,
      actualizadoEn: x.actualizado_en,
    })),
  }
}

export async function obtenerMetricasIA(companyId: string): Promise<MetricasIA> {
  const { data, error } = await supabase.rpc('metricas_ia_whatsapp', { p_company: companyId })
  if (error) throw fallo(error.message)
  return aMetricas(data as unknown as FilaMetricas)
}

export async function reintentarAnalisis(conversacionId: string): Promise<void> {
  const { error } = await supabase.rpc('reintentar_analisis_whatsapp', { p_conversacion: conversacionId })
  if (error) throw fallo(error.message)
}
