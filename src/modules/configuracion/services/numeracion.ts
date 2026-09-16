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
