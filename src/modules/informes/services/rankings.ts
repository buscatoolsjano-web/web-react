import { supabase } from '@/services/supabase/client'
import type { FilaRanking, ParametrosRanking } from '../types'
import { errorDeInforme } from './actividad'

/**
 * Una página del ranking, ya agregada y ordenada por el servidor
 * (`informe_rankings_comerciales`): ORDER BY estable + LIMIT/OFFSET.
 */
export async function obtenerRanking(
  companyId: string,
  mes: string | null,
  p: ParametrosRanking,
  limite: number,
  desplazamiento = 0,
): Promise<FilaRanking[]> {
  const { data, error } = await supabase.rpc('informe_rankings_comerciales', {
    p_company: companyId,
    p_mes: mes ? `${mes}-01` : null,
    p_dimension: p.dimension,
    p_fuente: p.fuente,
    p_medida: p.medida,
    p_periodo: p.periodo,
    p_moneda: p.moneda,
    p_limite: limite,
    p_desplazamiento: desplazamiento,
  })
  if (error) throw errorDeInforme(error.message)
  return data ?? []
}

/**
 * El ranking COMPLETO para el CSV, con los mismos filtros, de a 500 filas (el
 * tope del servidor). Cinturón: 40 páginas = 20.000 filas; el catálogo tiene
 * 21.775 productos pero sólo ~400 aparecen en documentos.
 */
export async function exportarRanking(companyId: string, mes: string | null, p: ParametrosRanking): Promise<FilaRanking[]> {
  const POR_PAGINA = 500
  const todas: FilaRanking[] = []
  for (let pagina = 0; pagina < 40; pagina++) {
    const filas = await obtenerRanking(companyId, mes, p, POR_PAGINA, pagina * POR_PAGINA)
    todas.push(...filas)
    const total = Number(filas[0]?.total_filas ?? 0)
    if (filas.length < POR_PAGINA || todas.length >= total) break
  }
  return todas
}
