import { supabase } from '@/services/supabase/client'
import { mapaAutoridad, type AutoridadNumeracion, type DocTypeVentas } from '../lib/autoridad'

/**
 * Autoridad de numeración de la empresa, sólo lectura. No hay (ni se usa)
 * ninguna función para cambiarla desde la app: pasar de STEL a ERP es un
 * cutover auditado que se hace en la base.
 */
export async function leerAutoridadNumeracion(
  companyId: string,
): Promise<Record<DocTypeVentas, AutoridadNumeracion>> {
  const { data, error } = await supabase.rpc('autoridad_numeracion_empresa', {
    p_company: companyId,
  })
  if (error) throw new Error(`No se pudo leer la autoridad de numeración: ${error.message}`)
  return mapaAutoridad(data ?? [])
}
