import { supabase } from '@/services/supabase/client'
import { normalizarEstado, type AutoridadSerie, type SecuenciaDiagnostico } from '../lib/numeracion'
import type { EntidadSync, EstadoSync, SyncStel } from '../lib/sync-stel'

/**
 * Diagnóstico de numeración: sólo lectura. No existe (ni se usa) ninguna
 * función para editar prefijos, próximos números ni resetear secuencias.
 */
export async function diagnosticoNumeracion(companyId: string): Promise<SecuenciaDiagnostico[]> {
  const { data, error } = await supabase.rpc('config_numeracion_diagnostico', { p_company: companyId })
  if (error) throw new Error(error.message.includes('sin_permiso') ? 'sin_permiso' : 'desconocido')
  return (data ?? []).map((f) => ({
    docType: f.doc_type,
    serie: f.series_code,
    prefijo: f.prefix,
    padding: f.padding,
    esDefault: f.is_default,
    proximo: f.proximo,
    proximoNumero: Number(f.next_number),
    documentos: Number(f.documentos),
    fueraPatron: Number(f.fuera_patron),
    maxNumero: f.max_numero === null ? null : Number(f.max_numero),
    maxSinAtipicos: f.max_numero_sin_atipicos === null ? null : Number(f.max_numero_sin_atipicos),
    atipicosPorEncima: Number(f.atipicos_por_encima),
    estado: normalizarEstado(f.estado),
    autoridad: f.autoridad === 'STEL' ? 'STEL' : 'ERP',
    autoridadConfigurada: f.autoridad_configurada === true,
  }))
}

/**
 * Estado del sync con STEL. Sólo para admin de la empresa: la RPC lo verifica.
 * No trae ni puede traer la clave de la API.
 */
export async function estadoSyncStel(companyId: string): Promise<SyncStel[]> {
  const { data, error } = await supabase.rpc('stel_sync_estado', { p_company: companyId })
  if (error) throw new Error(error.message.includes('sin_permiso') ? 'sin_permiso' : 'desconocido')
  return (data ?? []).map((f) => ({
    entidad: f.entity as EntidadSync,
    estado: f.last_status as EstadoSync,
    inicio: f.last_started_at,
    fin: f.last_finished_at,
    checkpoint: f.cursor_modified_at,
    ultimoVisto: f.cursor_external_id,
    llamadas: Number(f.last_calls ?? 0),
    error: f.last_error,
    bloqueado: f.locked === true,
    resumen: (f.last_summary ?? {}) as Record<string, unknown>,
  }))
}

/**
 * Excepciones de autoridad por serie. Si la consulta falla, la pantalla se
 * queda con la autoridad por tipo: es peor no mostrar nada que mostrar de menos.
 */
export async function autoridadPorSerie(companyId: string): Promise<AutoridadSerie[]> {
  const { data, error } = await supabase.rpc('autoridad_numeracion_series', { p_company: companyId })
  if (error) throw new Error(error.message.includes('sin_permiso') ? 'sin_permiso' : 'desconocido')
  return (data ?? []).map((f) => ({
    docType: f.doc_type,
    serie: f.series_code,
    autoridad: f.authority === 'STEL' ? 'STEL' : 'ERP',
    motivo: f.reason,
  }))
}

// ── Editar la numeración (Fase 58 · E3) ─────────────────────────────────────
/**
 * `document_sequences` NO TIENE POLÍTICAS RLS: sólo se llega por funciones
 * SECURITY DEFINER. Así que estas dos RPC son la única puerta de escritura, y
 * no hay un camino `from('document_sequences').update()` que se pueda usar en
 * su lugar.
 */

export class ErrorNumeracion extends Error {
  constructor(readonly codigo: string) {
    super(codigo)
    this.name = 'ErrorNumeracion'
  }
}

/* `numero_ocupado` y `serie_con_documentos` llegan con el número pegado
   (`numero_ocupado:2585`) y se conserva: cuál es el número ocupado es la mitad
   de la información útil. */
const CON_DATO = ['numero_ocupado', 'serie_con_documentos'] as const
const SIMPLES = [
  'sin_permiso', 'autoridad_externa', 'tipo_invalido', 'serie_invalida',
  'prefijo_invalido', 'relleno_invalido', 'numero_invalido',
  'sin_predeterminada', 'es_predeterminada', 'no_encontrado',
] as const

function deError(e: { message: string }): ErrorNumeracion {
  for (const c of CON_DATO) {
    const i = e.message.indexOf(`${c}:`)
    if (i >= 0) {
      // Los dígitos que siguen a los dos puntos. Sin regex armada con `c`
      // adentro: el prefijo ya está buscado, y lo único variable es el número.
      const digitos = /^\d+/.exec(e.message.slice(i + c.length + 1))
      return new ErrorNumeracion(digitos ? `${c}:${digitos[0]}` : c)
    }
    if (e.message.includes(c)) return new ErrorNumeracion(c)
  }
  const simple = SIMPLES.find((c) => e.message.includes(c))
  if (simple) return new ErrorNumeracion(simple)
  if (/failed to fetch|network/i.test(e.message)) return new ErrorNumeracion('sin_red')
  return new ErrorNumeracion('desconocido')
}

export interface SerieAGuardar {
  docType: string
  serie: string
  prefijo: string
  relleno: number
  proximo: number
  esDefault: boolean
  seleccionable: boolean
}

/** Alta o edición. Devuelve si creó o actualizó, para poder decirlo. */
export async function guardarSerie(companyId: string, s: SerieAGuardar): Promise<'CREATED' | 'UPDATED'> {
  const { data, error } = await supabase.rpc('config_numeracion_guardar', {
    p_company: companyId,
    p_doc_type: s.docType,
    p_series_code: s.serie,
    p_prefix: s.prefijo,
    p_padding: s.relleno,
    p_next_number: s.proximo,
    p_is_default: s.esDefault,
    p_is_selectable: s.seleccionable,
  })
  if (error) throw deError(error)
  return data === 'CREATED' ? 'CREATED' : 'UPDATED'
}

export async function eliminarSerie(companyId: string, docType: string, serie: string): Promise<void> {
  const { error } = await supabase.rpc('config_numeracion_eliminar', {
    p_company: companyId,
    p_doc_type: docType,
    p_series_code: serie,
  })
  if (error) throw deError(error)
}
