import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { consultarProductos } from '@/modules/catalogo/services/productos'
import { listarCategorias } from '@/modules/catalogo/services/facetas'
import { FILTROS_INICIALES } from '@/modules/catalogo/types'
import { construirPlanDeConsulta } from '@/modules/catalogo/lib/planDeConsulta'

/** Lo que se está mirando del catálogo dentro del documento. */
export interface FiltroCatalogoDocumento {
  texto: string
  /** id de categoría, o `''` para todas. */
  categoria: string
  pagina: number
}

export const POR_PAGINA = 25

/**
 * El catálogo, para elegir productos sin salir del documento (Fase 28 · E1).
 *
 * **Reusa el catálogo, no lo reimplementa**: la misma `consultarProductos` que
 * la pantalla de Catálogo, con el mismo `search_products` y las mismas
 * columnas. Por eso trae imagen, stock, marca y categoría sin pedir nada
 * aparte — y por eso un producto se ve igual acá que allá.
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
export function useCatalogoParaDocumento(filtro: FiltroCatalogoDocumento, listaPrecioId: string | null) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const esInterno = activa?.esInterno ?? false

  return useQuery({
    queryKey: ['ventas', companyId, 'catalogo-documento', filtro, listaPrecioId, esInterno],
    queryFn: () => {
      const plan = construirPlanDeConsulta(
        {
          ...FILTROS_INICIALES,
          q: filtro.texto,
          categoria: filtro.categoria || null,
          pagina: filtro.pagina,
          porPagina: POR_PAGINA,
          // Con búsqueda manda la relevancia; sin ella, el nombre.
          orden: filtro.texto.trim() === '' ? 'nombre' : 'relevancia',
        },
        companyId!,
      )
      return consultarProductos(plan, listaPrecioId, esInterno)
    },
    enabled: companyId !== null,
    // Mientras llega la página siguiente se sigue viendo la anterior: sin
    // esto la tabla parpadea a vacío en cada tecla.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

/** Las categorías del catálogo, para los botones de arriba. */
export function useCategoriasParaDocumento() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  return useQuery({
    queryKey: ['ventas', companyId, 'categorias-documento'],
    queryFn: () => listarCategorias(companyId!),
    enabled: companyId !== null,
    staleTime: 10 * 60_000,
  })
}
