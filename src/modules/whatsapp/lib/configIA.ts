/**
 * Configuración de la IA de WhatsApp por empresa (Fase 16 · E3). Lógica pura.
 *
 * La base es la autoridad: valida cada campo, sólo deja guardar a un admin y
 * cancela la cola cuando se apaga la IA. Lo de acá es no ofrecerle a nadie un
 * valor que va a volver rechazado, y decirlo en palabras.
 *
 * Proveedor y modelo NO se configuran desde la pantalla: son de servidor.
 */
import { textoDeErrorIA } from './ia'

export type ModoIA = 'desactivada' | 'manual' | 'automatica'

export const ETIQUETA_MODO: Record<ModoIA, string> = {
  desactivada: 'IA desactivada',
  manual: 'IA manual',
  automatica: 'IA automática',
}

export const DESCRIPCION_MODO: Record<ModoIA, string> = {
  desactivada: 'No se analiza ninguna conversación, ni a pedido ni sola. Los resúmenes ya guardados siguen visibles.',
  manual: 'Se analiza sólo cuando alguien aprieta «Actualizar resumen» en una conversación.',
  automatica: 'Las conversaciones con mensajes nuevos se analizan solas, después de un rato sin actividad.',
}

/** Lo que se muestra; el valor real está en los secrets de la Edge Function. */
export const PROVEEDOR_VISIBLE = 'OpenAI'
export const MODELO_VISIBLE = 'gpt-5.6-luna'
export const ZONA_HORARIA = 'America/Argentina/Buenos_Aires'

export const DEBOUNCE_MIN = 30
export const DEBOUNCE_MAX = 3600

export const DIAS_SEMANA: { valor: number; etiqueta: string }[] = [
  { valor: 1, etiqueta: 'Lunes' },
  { valor: 2, etiqueta: 'Martes' },
  { valor: 3, etiqueta: 'Miércoles' },
  { valor: 4, etiqueta: 'Jueves' },
  { valor: 5, etiqueta: 'Viernes' },
  { valor: 6, etiqueta: 'Sábado' },
  { valor: 7, etiqueta: 'Domingo' },
]

export interface ConfigIA {
  companyId: string
  enabled: boolean
  autoAnalyze: boolean
  dailyReportEnabled: boolean
  weeklyReportEnabled: boolean
  dailyReportTime: string | null
  weeklyReportDay: number | null
  weeklyReportTime: string | null
  debounceSeconds: number
  maxDailyAnalyses: number | null
  maxDailyCostUsd: number | null
  timezone: string
  updatedAt: string | null
  modo: ModoIA
}

/** El formulario: todo texto o booleano, como lo da un input. */
export interface FormularioIA {
  enabled: boolean
  autoAnalyze: boolean
  debounceSeconds: string
  maxDailyAnalyses: string
  maxDailyCostUsd: string
  dailyReportEnabled: boolean
  dailyReportTime: string
  weeklyReportEnabled: boolean
  weeklyReportDay: string
  weeklyReportTime: string
}

export type CampoIA = keyof FormularioIA

export function formularioDesdeConfig(c: ConfigIA): FormularioIA {
  return {
    enabled: c.enabled,
    autoAnalyze: c.autoAnalyze,
    debounceSeconds: String(c.debounceSeconds),
    maxDailyAnalyses: c.maxDailyAnalyses === null ? '' : String(c.maxDailyAnalyses),
    maxDailyCostUsd: c.maxDailyCostUsd === null ? '' : String(c.maxDailyCostUsd),
    dailyReportEnabled: c.dailyReportEnabled,
    dailyReportTime: c.dailyReportTime ?? '',
    weeklyReportEnabled: c.weeklyReportEnabled,
    weeklyReportDay: c.weeklyReportDay === null ? '' : String(c.weeklyReportDay),
    weeklyReportTime: c.weeklyReportTime ?? '',
  }
}

/** El modo que resultaría de guardar este formulario. */
export function modoDe(f: Pick<FormularioIA, 'enabled' | 'autoAnalyze'>): ModoIA {
  if (!f.enabled) return 'desactivada'
  return f.autoAnalyze ? 'automatica' : 'manual'
}

const ENTERO = /^\d+$/
const DECIMAL = /^\d+([.,]\d{1,4})?$/
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

export function erroresConfig(f: FormularioIA): Partial<Record<CampoIA, string>> {
  const e: Partial<Record<CampoIA, string>> = {}
  const d = f.debounceSeconds.trim()
  if (!ENTERO.test(d) || Number(d) < DEBOUNCE_MIN || Number(d) > DEBOUNCE_MAX) {
    e.debounceSeconds = `Entre ${DEBOUNCE_MIN} y ${DEBOUNCE_MAX} segundos.`
  }
  const a = f.maxDailyAnalyses.trim()
  if (a && (!ENTERO.test(a) || Number(a) < 1 || Number(a) > 10000)) {
    e.maxDailyAnalyses = 'Un número entero entre 1 y 10000, o vacío para no limitar.'
  }
  const u = f.maxDailyCostUsd.trim()
  if (u && (!DECIMAL.test(u) || Number(u.replace(',', '.')) <= 0 || Number(u.replace(',', '.')) > 1000)) {
    e.maxDailyCostUsd = 'Un monto mayor a 0 y hasta 1000 USD (hasta 4 decimales), o vacío para no limitar.'
  }
  if (f.dailyReportEnabled && !HORA.test(f.dailyReportTime)) e.dailyReportTime = 'Elegí la hora del informe diario.'
  if (f.dailyReportTime && !HORA.test(f.dailyReportTime)) e.dailyReportTime = 'Hora inválida (HH:MM).'
  if (f.weeklyReportEnabled && !f.weeklyReportDay) e.weeklyReportDay = 'Elegí el día del informe semanal.'
  if (f.weeklyReportEnabled && !HORA.test(f.weeklyReportTime)) e.weeklyReportTime = 'Elegí la hora del informe semanal.'
  if (f.weeklyReportTime && !HORA.test(f.weeklyReportTime)) e.weeklyReportTime = 'Hora inválida (HH:MM).'
  return e
}

/**
 * Lo que se manda a la base: SÓLO lo que cambió, con los nombres y tipos de la
 * RPC. Vacío en un límite = sin límite (null).
 */
export function cambiosConfig(inicial: FormularioIA, f: FormularioIA): Record<string, boolean | number | string | null> {
  const c: Record<string, boolean | number | string | null> = {}
  const num = (s: string) => (s.trim() === '' ? null : Number(s.trim().replace(',', '.')))
  const texto = (s: string) => (s.trim() === '' ? null : s.trim())
  if (f.enabled !== inicial.enabled) c.enabled = f.enabled
  if (f.autoAnalyze !== inicial.autoAnalyze) c.auto_analyze = f.autoAnalyze
  if (f.debounceSeconds.trim() !== inicial.debounceSeconds.trim()) c.analysis_debounce_seconds = num(f.debounceSeconds)
  if (f.maxDailyAnalyses.trim() !== inicial.maxDailyAnalyses.trim()) c.max_daily_analyses = num(f.maxDailyAnalyses)
  if (f.maxDailyCostUsd.trim() !== inicial.maxDailyCostUsd.trim()) c.max_daily_cost_usd = num(f.maxDailyCostUsd)
  if (f.dailyReportEnabled !== inicial.dailyReportEnabled) c.daily_report_enabled = f.dailyReportEnabled
  if (f.dailyReportTime !== inicial.dailyReportTime) c.daily_report_time = texto(f.dailyReportTime)
  if (f.weeklyReportEnabled !== inicial.weeklyReportEnabled) c.weekly_report_enabled = f.weeklyReportEnabled
  if (f.weeklyReportDay !== inicial.weeklyReportDay) c.weekly_report_day = num(f.weeklyReportDay)
  if (f.weeklyReportTime !== inicial.weeklyReportTime) c.weekly_report_time = texto(f.weeklyReportTime)
  return c
}

const TEXTO_ERROR_CONFIG: Record<string, string> = {
  sin_permiso: 'Sólo un administrador de la empresa puede ver y cambiar la IA de WhatsApp.',
  conflicto_version: 'Otra persona guardó cambios mientras editabas. Recargá para ver la versión actual.',
  config_invalida: 'Algún valor no es válido. Revisá los campos marcados.',
  campo_no_editable: 'Ese dato no se cambia desde acá.',
  no_reintentable: 'Ese análisis ya no está fallido.',
  ia_automatica_apagada: 'Para reintentar, la IA automática tiene que estar encendida.',
}

export function textoErrorConfig(codigo: string): string {
  return TEXTO_ERROR_CONFIG[codigo] ?? 'No se pudo completar la operación. Probá de nuevo.'
}

/** Un código de la base (`SIN_PERMISO`, …) desde el mensaje de error de PostgREST. */
export function codigoDeError(mensaje: string): string {
  const m = /\b(SIN_PERMISO|CONFLICTO_VERSION|CONFIG_INVALIDA|CAMPO_NO_EDITABLE|NO_REINTENTABLE|IA_AUTOMATICA_APAGADA)\b/.exec(mensaje)
  return m ? m[1]!.toLowerCase() : 'desconocido'
}

// ── Observabilidad ────────────────────────────────────────────────────────

export interface MetricasPeriodo {
  corridas: number
  llamadas: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  costoUsd: number
  errores: number
  omitidas: number
}

export interface TrabajoFallido {
  conversacionId: string
  contacto: string
  error: string | null
  intentos: number
  actualizadoEn: string
}

export interface MetricasIA {
  hoy: MetricasPeriodo
  ultimos7Dias: MetricasPeriodo
  mes: MetricasPeriodo
  cola: { pendientes: number; procesando: number; fallidos: number; limiteAlcanzado: number; cancelados: number }
  proveedor: { proveedor: string | null; modelo: string | null; ultimoOkEn: string | null; ultimoError: string | null; ultimoErrorEn: string | null; noDisponible: boolean }
  fallidos: TrabajoFallido[]
}

/** USD con los decimales que tiene sentido mirar: centavos de centavo. */
export function usd(n: number): string {
  if (n === 0) return 'USD 0'
  const decimales = n >= 1 ? 2 : n >= 0.01 ? 4 : 6
  return `USD ${n.toFixed(decimales)}`
}

export function miles(n: number): string {
  return new Intl.NumberFormat('es-AR').format(n)
}

export type TonoAlerta = 'danger' | 'warning' | 'info'

/** Indicadores para el panel. NO son notificaciones: se ven al entrar. */
export function alertasIA(m: MetricasIA, modo: ModoIA): { clave: string; tono: TonoAlerta; texto: string }[] {
  const a: { clave: string; tono: TonoAlerta; texto: string }[] = []
  if (m.proveedor.noDisponible) {
    a.push({ clave: 'proveedor', tono: 'danger', texto: `Proveedor no disponible: ${textoDeErrorIA(m.proveedor.ultimoError)}` })
  }
  if (m.cola.limiteAlcanzado > 0) {
    a.push({ clave: 'limite', tono: 'warning', texto: `Límite diario alcanzado: ${m.cola.limiteAlcanzado} conversación(es) esperan a mañana.` })
  }
  if (m.cola.fallidos > 0) {
    a.push({ clave: 'fallidos', tono: 'warning', texto: `${m.cola.fallidos} análisis fallido(s) para revisar.` })
  }
  if (m.cola.pendientes + m.cola.procesando > 0 && modo === 'automatica') {
    a.push({ clave: 'pendientes', tono: 'info', texto: `${m.cola.pendientes + m.cola.procesando} conversación(es) pendiente(s) de análisis.` })
  }
  return a
}

/** El error de un trabajo fallido, en palabras. */
export function textoErrorTrabajo(codigo: string | null): string {
  if (codigo === 'lock_vencido') return 'El análisis se interrumpió varias veces.'
  if (codigo === 'worker_excepcion') return 'Error inesperado del análisis automático.'
  if (codigo === 'limit_reached') return 'Límite diario alcanzado.'
  return textoDeErrorIA(codigo)
}
