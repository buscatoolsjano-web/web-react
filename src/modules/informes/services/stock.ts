import { supabase } from '@/services/supabase/client'
import type { FilaKardex, FilaMovimiento, FilaResumenStock, FilaStock, FiltrosMovimientos, FiltrosStock } from '../types'
import { errorDeInforme } from './actividad'

/**
 * Stock físico: las funciones de la Entrega 4. Todo filtrado, contado y
 * paginado en el servidor; la pantalla nunca baja el catálogo.
 */

const aMesSql = (mes: string | null) => (mes ? `${mes}-01` : null)
const POR_PAGINA_CSV = 500
/** Cinturón del CSV: 40 páginas = 20.000 filas. */
const PAGINAS_CSV = 40

export async function obtenerResumenStock(companyId: string, mes: string | null): Promise<FilaResumenStock[]> {
  const { data, error } = await supabase.rpc('informe_stock_resumen', { p_company: companyId, p_mes: aMesSql(mes) })
  if (error) throw errorDeInforme(error.message)
  return data ?? []
}

export async function obtenerCatalogoStock(companyId: string): Promise<{ categoria: string; cantidad: number }[]> {
  const { data, error } = await supabase.rpc('informe_stock_catalogo', { p_company: companyId })
  if (error) throw errorDeInforme(error.message)
  return data ?? []
}

export async function obtenerStock(companyId: string, f: FiltrosStock, limite: number, desplazamiento: number): Promise<FilaStock[]> {
  const { data, error } = await supabase.rpc('informe_stock_actual', {
    p_company: companyId,
    p_busqueda: f.busqueda.trim() || null,
    p_deposito: f.deposito,
    p_estado: f.estado,
    p_limite: limite,
    p_desplazamiento: desplazamiento,
  })
  if (error) throw errorDeInforme(error.message)
  return data ?? []
}

export async function obtenerMovimientos(
  companyId: string,
  mes: string | null,
  f: FiltrosMovimientos,
  limite: number,
  desplazamiento: number,
): Promise<FilaMovimiento[]> {
  const { data, error } = await supabase.rpc('informe_movimientos_stock', {
    p_company: companyId,
    p_mes: aMesSql(mes),
    p_deposito: f.deposito,
    p_tipo: f.tipo,
    p_sentido: f.sentido,
    p_producto: null,
    p_limite: limite,
    p_desplazamiento: desplazamiento,
  })
  if (error) throw errorDeInforme(error.message)
  return data ?? []
}

export async function obtenerKardex(
  companyId: string,
  productoId: string,
  deposito: string | null,
  orden: 'asc' | 'desc',
  limite: number,
  desplazamiento: number,
): Promise<FilaKardex[]> {
  const { data, error } = await supabase.rpc('informe_kardex_producto', {
    p_company: companyId,
    p_producto: productoId,
    p_deposito: deposito,
    p_orden: orden,
    p_limite: limite,
    p_desplazamiento: desplazamiento,
  })
  if (error) throw errorDeInforme(error.message)
  return data ?? []
}

/** Todas las páginas de a 500 con los mismos filtros, hasta `total_filas`. */
async function todasLasPaginas<T extends { total_filas: number }>(pedir: (limite: number, desplazamiento: number) => Promise<T[]>): Promise<T[]> {
  const todas: T[] = []
  for (let pagina = 0; pagina < PAGINAS_CSV; pagina++) {
    const filas = await pedir(POR_PAGINA_CSV, pagina * POR_PAGINA_CSV)
    todas.push(...filas)
    if (filas.length < POR_PAGINA_CSV || todas.length >= Number(filas[0]?.total_filas ?? 0)) break
  }
  return todas
}

export const exportarStock = (companyId: string, f: FiltrosStock) =>
  todasLasPaginas((l, d) => obtenerStock(companyId, f, l, d))

export const exportarMovimientos = (companyId: string, mes: string | null, f: FiltrosMovimientos) =>
  todasLasPaginas((l, d) => obtenerMovimientos(companyId, mes, f, l, d))
