import { useQuery } from '@tanstack/react-query'
import { construirPlanDeConsulta } from '../lib/planDeConsulta'
import {
  obtenerFacetas,
  listaPorDefecto,
  listarCategorias,
  listarDefinicionesDeAtributos,
  listarListasDePrecios,
  listarMarcas,
  listarAtributosPorCategoria,
} from '../services/facetas'
import type { Facetas, FiltrosCatalogo, ListaDePrecios } from '../types'

/**
 * Datos de apoyo del catálogo: marcas, categorías, atributos y listas.
 *
 * Cambian muy poco (25, 8, 26 y 4 filas), así que van con staleTime de 5
 * minutos. Se piden una vez por sesión y por empresa.
 *
 * `companyId` es la primera parte de cada clave: al cambiar de empresa,
 * TanStack Query no puede confundir una caché con otra ni por accidente.
 */
const CINCO_MINUTOS = 5 * 60_000

export function useMarcas(companyId: string | null) {
  return useQuery({
    queryKey: ['catalogo', companyId, 'marcas'],
    queryFn: () => listarMarcas(companyId!),
    enabled: companyId !== null,
    staleTime: CINCO_MINUTOS,
  })
}

export function useCategorias(companyId: string | null) {
  return useQuery({
    queryKey: ['catalogo', companyId, 'categorias'],
    queryFn: () => listarCategorias(companyId!),
    enabled: companyId !== null,
    staleTime: CINCO_MINUTOS,
  })
}

export function useDefinicionesDeAtributos(companyId: string | null) {
  return useQuery({
    queryKey: ['catalogo', companyId, 'atributos'],
    queryFn: () => listarDefinicionesDeAtributos(companyId!),
    enabled: companyId !== null,
    staleTime: CINCO_MINUTOS,
  })
}

export interface EstadoListasDePrecios {
  listas: ListaDePrecios[]
  /** La lista que se usa si el usuario no eligió otra. */
  porDefecto: ListaDePrecios | null
  /** true cuando hay más de una: recién ahí tiene sentido mostrar el selector. */
  puedeElegir: boolean
  cargando: boolean
}

/**
 * Listas de precios visibles.
 *
 * RLS decide cuáles llegan. Un customer recibe exactamente una, así que
 * `puedeElegir` es false y no se dibuja ningún selector: no hay entre qué
 * elegir. Un interno recibe las tres de su empresa.
 */
export function useListasDePrecios(companyId: string | null): EstadoListasDePrecios {
  const { data, isPending } = useQuery({
    queryKey: ['catalogo', companyId, 'listasDePrecios'],
    queryFn: () => listarListasDePrecios(companyId!),
    enabled: companyId !== null,
    staleTime: CINCO_MINUTOS,
  })

  const listas = data ?? []
  return {
    listas,
    porDefecto: listaPorDefecto(listas),
    puedeElegir: listas.length > 1,
    cargando: companyId !== null && isPending,
  }
}

/**
 * Relación atributo → categorías (70 filas). Cambia muy poco: staleTime largo.
 */
export function useAtributosPorCategoria(companyId: string | null) {
  return useQuery({
    queryKey: ['catalogo', companyId, 'atributosPorCategoria'],
    queryFn: () => listarAtributosPorCategoria(companyId!),
    enabled: companyId !== null,
    staleTime: CINCO_MINUTOS,
  })
}

/**
 * Opciones disponibles para cada filtro, dado el contexto actual.
 *
 * Depende de los filtros, así que la clave de caché los incluye. Sigue
 * llevando `companyId` primero: al cambiar de empresa, TanStack Query no
 * puede confundir una entrada con otra.
 *
 * `placeholderData` mantiene visibles las opciones anteriores mientras
 * llegan las nuevas, para que los conteos no parpadeen en cada click —
 * PERO SÓLO DENTRO DE LA MISMA EMPRESA, porque si no anularía el
 * removeQueries del cambio de empresa y se verían facetas de la anterior.
 */
export function useFacetas(companyId: string | null, filtros: FiltrosCatalogo) {
  return useQuery<Facetas>({
    queryKey: ['catalogo', companyId, 'facetas', { ...filtros, pagina: 1, porPagina: 0 }],
    queryFn: () => obtenerFacetas(construirPlanDeConsulta(filtros, companyId!)),
    enabled: companyId !== null,
    placeholderData: (previa, consultaPrevia) => {
      const empresaPrevia = consultaPrevia?.queryKey[1]
      return empresaPrevia === companyId ? previa : undefined
    },
    staleTime: 30_000,
  })
}
