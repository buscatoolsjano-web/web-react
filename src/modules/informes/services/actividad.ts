import { supabase } from '@/services/supabase/client'
import type { FilaActividad } from '../types'

export class ErrorInforme extends Error {
  constructor(readonly codigo: 'sin_permiso' | 'mes_futuro' | 'desconocido', mensaje: string) {
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
  if (error) {
    if (/sin_permiso/.test(error.message)) throw new ErrorInforme('sin_permiso', 'Tu rol en esta empresa no tiene acceso a Informes.')
    if (/mes_futuro/.test(error.message)) throw new ErrorInforme('mes_futuro', 'Ese mes todavía no empezó.')
    throw new ErrorInforme('desconocido', 'No se pudo leer el informe. Probá de nuevo en un momento.')
  }
  return data ?? []
}
