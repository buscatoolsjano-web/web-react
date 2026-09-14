import { supabase } from '@/services/supabase/client'
import { normalizarEstado, type SecuenciaDiagnostico } from '../lib/numeracion'

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
