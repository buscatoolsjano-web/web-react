import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { consultarProductos } from '@/modules/catalogo/services/productos'
import { obtenerFacetas } from '@/modules/catalogo/services/facetas'
import type { FiltrosCatalogo } from '@/modules/catalogo/types'
import { construirPlanDeConsulta } from '@/modules/catalogo/lib/planDeConsulta'

export const POR_PAGINA = 25

/**
 * El catálogo, para elegir productos sin salir del documento (Fase 28 · E1).
 *
 * **Reusa el catálogo, no lo reimplementa**: los mismos `FiltrosCatalogo`, el
 * mismo `construirPlanDeConsulta`, la misma `consultarProductos` sobre
 * `search_products` y las mismas facetas de `catalog_facets`. Por eso trae
 * imagen, stock, marca y categoría sin pedir nada aparte, por eso un producto
 * se ve igual acá que allá, y por eso al elegir una categoría aparecen sus
 * atributos —encastre, medida, largo— con los valores que existen de verdad.
 *
 * Dos diferencias con la pantalla de Catálogo, las dos porque esto es un
 * documento de venta y no una vidriera:
 *
 *  · El precio sale de la **tarifa del documento**, no de la lista que la
 *    persona esté mirando en el Catálogo.
 *  · Se listan productos **aunque no haya texto**: con una categoría elegida
 *    se recorre, que es lo que hace el sistema anterior. El buscador de antes
 *    exigía dos letras y no dejaba explorar.
 */
export function useCatalogoParaDocumento(filtros: FiltrosCatalogo, listaPrecioId: string | null) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const esInterno = activa?.esInterno ?? false

  return useQuery({
    queryKey: ['ventas', companyId, 'catalogo-documento', filtros, listaPrecioId, esInterno],
    queryFn: () => consultarProductos(construirPlanDeConsulta(filtros, companyId!), listaPrecioId, esInterno),
    enabled: companyId !== null,
    // Mientras llega la página siguiente se sigue viendo la anterior: sin
    // esto la tabla parpadea a vacío en cada tecla.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

/**
 * Las opciones de cada filtro, dado lo que ya está filtrado.
 *
 * Las calcula el servidor con todos los filtros activos MENOS el suyo, así que
 * nunca ofrece una opción que daría cero. Es la misma RPC que usa la pantalla
 * de Catálogo: una sola definición de qué se puede filtrar.
 */
export function useFacetasParaDocumento(filtros: FiltrosCatalogo) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery({
    queryKey: ['ventas', companyId, 'facetas-documento', filtros],
    queryFn: () => obtenerFacetas(construirPlanDeConsulta(filtros, companyId!)),
    enabled: companyId !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
}
