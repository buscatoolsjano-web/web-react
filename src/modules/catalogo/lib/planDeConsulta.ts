import type { FiltrosCatalogo } from '../types'

/**
 * Descripción declarativa de la consulta de productos.
 *
 * Se separa del cliente Supabase a propósito: así la parte que decide QUÉ
 * se pide es una función pura, testeable sin red, y el service se limita a
 * pasarla a la RPC.
 *
 * Desde la Fase 3.6 el listado y la búsqueda usan la MISMA función SQL
 * (`search_products`), así que hay una sola definición de qué productos
 * entran. Antes había dos —la RPC para buscar y una cadena de PostgREST para
 * listar— y mantenerlas en paralelo con multiselección y rangos era pedir que
 * el total del paginador y el de las facetas se desincronizaran.
 */
export interface PlanDeConsulta {
  companyId: string
  /** Texto de búsqueda, o null si es un listado sin búsqueda. */
  texto: string | null
  categoria: string | null
  marca: string | null
  serie: string | null
  subtipos: string[] | null
  /** OR dentro de la clave, AND entre claves. */
  atributos: Record<string, string[]> | null
  /** Rangos numéricos, ya normalizados. */
  rangos: Record<string, { min?: number; max?: number }> | null
  limite: number
  desplazamiento: number
  orden: 'nombre' | 'sku'
}

export const MAX_POR_PAGINA = 100

/**
 * Traduce los filtros de la UI a un plan de consulta.
 *
 * `companyId` NO es defensa en profundidad, es funcionalmente obligatorio:
 * RLS deja ver TODAS las empresas del usuario, y Jano pertenece a dos. Sin
 * este filtro vería productos de Buscatools y Torquetools mezclados.
 */
export function construirPlanDeConsulta(
  filtros: FiltrosCatalogo,
  companyId: string,
): PlanDeConsulta {
  if (!companyId) {
    throw new Error('construirPlanDeConsulta requiere companyId: sin empresa activa no se consulta.')
  }

  const porPagina = Math.min(Math.max(filtros.porPagina, 1), MAX_POR_PAGINA)
  const pagina = Math.max(filtros.pagina, 1)

  // Los valores vacíos no filtran nada: se descartan para no mandar
  // `{"encastre": [""]}`, que no coincide con ningún producto.
  const atributos: Record<string, string[]> = {}
  for (const [k, valores] of Object.entries(filtros.atributos)) {
    const limpios = valores.filter((v) => v !== '')
    if (limpios.length > 0) atributos[k] = limpios
  }

  // Un rango sin ningún extremo tampoco filtra: se descarta.
  const rangos: Record<string, { min?: number; max?: number }> = {}
  for (const [k, r] of Object.entries(filtros.rangos)) {
    const entrada: { min?: number; max?: number } = {}
    if (r.min !== null) entrada.min = r.min
    if (r.max !== null) entrada.max = r.max
    if (entrada.min !== undefined || entrada.max !== undefined) rangos[k] = entrada
  }

  const texto = filtros.q.trim()

  return {
    companyId,
    texto: texto.length >= 2 ? texto : null,
    categoria: filtros.categoria,
    marca: filtros.marca,
    serie: filtros.serie,
    subtipos: filtros.subtipos.length > 0 ? filtros.subtipos : null,
    atributos: Object.keys(atributos).length > 0 ? atributos : null,
    rangos: Object.keys(rangos).length > 0 ? rangos : null,
    limite: porPagina,
    desplazamiento: (pagina - 1) * porPagina,
    orden: filtros.orden === 'sku' ? 'sku' : 'nombre',
  }
}

/** ¿Hay texto de búsqueda? Con menos de 2 caracteres no se busca. */
export function hayBusqueda(filtros: FiltrosCatalogo): boolean {
  return filtros.q.trim().length >= 2
}

/** Cuántos filtros activos, para el botón "Filtros (N)" en mobile. */
export function contarFiltrosActivos(filtros: FiltrosCatalogo): number {
  let n = 0
  if (filtros.marca) n++
  if (filtros.categoria) n++
  if (filtros.serie) n++
  n += filtros.subtipos.length
  // Cada VALOR elegido cuenta: elegir dos encastres son dos filtros para
  // quien mira el botón, aunque en SQL sea un OR sobre una sola clave.
  for (const valores of Object.values(filtros.atributos)) {
    n += valores.filter((v) => v !== '').length
  }
  for (const r of Object.values(filtros.rangos)) {
    if (r.min !== null || r.max !== null) n++
  }
  return n
}
