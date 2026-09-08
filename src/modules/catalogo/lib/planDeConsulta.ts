import type { FiltrosCatalogo } from '../types'

/**
 * Descripción declarativa de la consulta de productos.
 *
 * Se separa del cliente Supabase a propósito: así la parte que decide QUÉ
 * se pide es una función pura, testeable sin red, y el service se limita a
 * traducirla a la cadena de PostgREST.
 */
export interface PlanDeConsulta {
  companyId: string
  /** Igualdades simples sobre columnas de products. */
  eq: Record<string, string>
  /** Contención sobre el jsonb `attributes` (operador @>). */
  atributos: Record<string, string>
  rango: { desde: number; hasta: number }
  orden: { columna: string; ascendente: boolean }
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
  const desde = (pagina - 1) * porPagina

  const eq: Record<string, string> = {}
  if (filtros.marca) eq['brand_id'] = filtros.marca
  if (filtros.categoria) eq['category_id'] = filtros.categoria
  if (filtros.serie) eq['series'] = filtros.serie

  // Los valores vacíos no filtran nada: se descartan para no mandar
  // `attributes @> {"encastre": ""}`, que no matchea nunca.
  const atributos: Record<string, string> = {}
  for (const [k, v] of Object.entries(filtros.atributos)) {
    if (v !== '') atributos[k] = v
  }

  return {
    companyId,
    eq,
    atributos,
    rango: { desde, hasta: desde + porPagina - 1 },
    orden:
      filtros.orden === 'sku'
        ? { columna: 'sku', ascendente: true }
        : { columna: 'name', ascendente: true },
  }
}

/** ¿Hay texto de búsqueda? Decide si se usa la RPC o la consulta normal. */
export function hayBusqueda(filtros: FiltrosCatalogo): boolean {
  return filtros.q.trim().length >= 2
}

/** Cuántos filtros activos, para el botón "Filtros (N)" en mobile. */
export function contarFiltrosActivos(filtros: FiltrosCatalogo): number {
  let n = 0
  if (filtros.marca) n++
  if (filtros.categoria) n++
  if (filtros.serie) n++
  n += Object.values(filtros.atributos).filter((v) => v !== '').length
  return n
}
