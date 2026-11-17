import { useQuery } from '@tanstack/react-query'
import { obtenerFacetas } from '../services/facetas'
import { construirPlanDeConsulta } from '../lib/planDeConsulta'
import { FILTROS_INICIALES, type OpcionFaceta } from '../types'

/**
 * Los valores que ya existen de cada característica en un rubro, con cuántos
 * productos los usan. Es lo que ofrece la lista desplegable al editar una
 * característica: elegir de lo que hay antes que escribirlo de nuevo.
 *
 * Sale de las mismas facetas del catálogo (`catalog_facets`), filtradas por la
 * categoría del producto: los valores son los de su rubro, no los de todo el
 * catálogo. Se cachea cinco minutos, como las facetas.
 */
export function useValoresDeAtributos(companyId: string | null, categoriaId: string | null) {
  return useQuery<ReadonlyMap<string, OpcionFaceta[]>>({
    queryKey: ['catalogo', companyId, 'valores-de-atributos', categoriaId],
    queryFn: async () => {
      const facetas = await obtenerFacetas(
        construirPlanDeConsulta({ ...FILTROS_INICIALES, categoria: categoriaId }, companyId!),
      )
      const mapa = new Map<string, OpcionFaceta[]>()
      for (const f of facetas.atributos) mapa.set(f.key, f.opciones)
      return mapa
    },
    enabled: companyId !== null && categoriaId !== null && categoriaId !== '',
    staleTime: 5 * 60_000,
  })
}
