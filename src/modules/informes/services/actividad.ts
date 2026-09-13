import { supabase } from '@/services/supabase/client'
import type { FilaActividad, FilaPipeline } from '../types'

export class ErrorInforme extends Error {
  constructor(readonly codigo: 'sin_permiso' | 'mes_futuro' | 'parametro_invalido' | 'sin_importe' | 'desconocido', mensaje: string) {
    super(mensaje)
    this.name = 'ErrorInforme'
  }
}

/**
 * La actividad comercial, ya agregada por el servidor: sumas por tipo de
 * documento, mes y moneda. Nunca baja documentos ni líneas.
 *
 * `mes` es `YYYY-MM`; `null` es el mes en curso (según la hora de Argentina,
 * que decide el servidor).
 */
export async function obtenerActividad(companyId: string, mes: string | null): Promise<FilaActividad[]> {
  const { data, error } = await supabase.rpc('informe_actividad_comercial', {
    p_company: companyId,
    p_mes: mes ? `${mes}-01` : null,
  })
  if (error) throw errorDeInforme(error.message)
  return data ?? []
}

/**
 * Pipeline, conversión y cumplimiento, ya agregados por el servidor. Mismo
 * `mes` y mismos errores que la actividad.
 */
export async function obtenerPipeline(companyId: string, mes: string | null): Promise<FilaPipeline[]> {
  const { data, error } = await supabase.rpc('informe_pipeline_comercial', {
    p_company: companyId,
    p_mes: mes ? `${mes}-01` : null,
  })
  if (error) throw errorDeInforme(error.message)
  return data ?? []
}

export function errorDeInforme(mensaje: string): ErrorInforme {
  if (/sin_permiso/.test(mensaje)) return new ErrorInforme('sin_permiso', 'Tu rol en esta empresa no tiene acceso a Informes.')
  if (/mes_futuro/.test(mensaje)) return new ErrorInforme('mes_futuro', 'Ese mes todavía no empezó.')
  if (/sin_importe/.test(mensaje)) return new ErrorInforme('sin_importe', 'Los remitos no tienen precio: ese ranking sólo existe por cantidad.')
  if (/parametro_invalido/.test(mensaje)) return new ErrorInforme('parametro_invalido', 'Esa combinación de ranking no existe.')
  return new ErrorInforme('desconocido', 'No se pudo leer el informe. Probá de nuevo en un momento.')
}
