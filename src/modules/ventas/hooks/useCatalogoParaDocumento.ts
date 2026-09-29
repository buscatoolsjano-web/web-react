import { useEffect } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { consultarProductos } from '@/modules/catalogo/services/productos'
import { obtenerFacetas } from '@/modules/catalogo/services/facetas'
import { FILTROS_INICIALES, type FiltrosCatalogo } from '@/modules/catalogo/types'
import { construirPlanDeConsulta } from '@/modules/catalogo/lib/planDeConsulta'

export const POR_PAGINA = 25

/**
 * Con qué filtros abre el modal del catálogo.
 *
 * Vive acá y no en el modal porque lo necesitan DOS: el modal, para consultar,
 * y la precarga, para dejar esa misma consulta ya resuelta. Si cada uno armara
 * los suyos, bastaría un campo distinto para que la clave no coincidiera: la
 * precarga seguiría corriendo, el modal seguiría esperando, y nadie se
 * enteraría de que dejó de servir.
 */
export const FILTROS_MODAL: FiltrosCatalogo = { ...FILTROS_INICIALES, porPagina: POR_PAGINA }

/** Las dos claves, en un solo lugar, por la misma razón. */
const clavePagina = (
  companyId: string | null,
  filtros: FiltrosCatalogo,
  listaPrecioId: string | null,
  esInterno: boolean,
) => ['ventas', companyId, 'catalogo-documento', filtros, listaPrecioId, esInterno] as const

const claveFacetas = (companyId: string | null, filtros: FiltrosCatalogo) =>
  ['ventas', companyId, 'facetas-documento', filtros] as const

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
    queryKey: clavePagina(companyId, filtros, listaPrecioId, esInterno),
    queryFn: () => consultarProductos(construirPlanDeConsulta(filtros, companyId!), listaPrecioId, esInterno),
    enabled: companyId !== null,
    // Mientras llega la página siguiente se sigue viendo la anterior: sin
    // esto la tabla parpadea a vacío en cada tecla.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    // Que el resultado sobreviva a cerrar el modal (Fase 29 · E18).
    //
    // Por defecto react-query tira una consulta que nadie está mirando a los 5
    // minutos, y el modal deja de mirarla apenas se cierra. Media hora después
    // de trabajar en un documento, volver a abrirlo costaba lo mismo que la
    // primera vez. Con `gcTime` largo, reabrir muestra lo de antes EN EL ACTO
    // y refresca por detrás: el spinner sólo aparece cuando no hay nada.
    gcTime: 30 * 60_000,
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
    queryKey: claveFacetas(companyId, filtros),
    queryFn: () => obtenerFacetas(construirPlanDeConsulta(filtros, companyId!)),
    enabled: companyId !== null,
    placeholderData: keepPreviousData,
    // Las facetas son lo más caro de todo el modal: ~85 ms de CPU, porque
    // recorren los productos de la empresa y los agrupan de cinco maneras. Y
    // son lo que menos cambia: sólo se mueven cuando cambia el catálogo.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })
}

/**
 * Dejar el catálogo listo ANTES de que lo pidan (Fase 29 · E18).
 *
 * El modal tardaba en abrir y mostraba «buscando». Medido contra São Paulo, la
 * espera no era una sola cosa:
 *
 *  · `catalog_facets` sin filtros tarda **76 ms de servidor**: recorre los
 *    21.775 productos de la empresa y los agrupa por marca, categoría, tipo,
 *    atributos y rangos. Con el modal recién abierto ese resultado es siempre
 *    el mismo.
 *  · `search_products` son otros 24 ms, y **su resultado necesita un segundo
 *    viaje** para traer las filas: la RPC devuelve el orden y los ids, y
 *    recién ahí se piden los productos. Son dos idas y vueltas encadenadas.
 *
 * Nada de eso se arregla pidiéndolo más rápido: se arregla pidiéndolo ANTES.
 * Cuando alguien está editando un documento, que va a abrir el catálogo es
 * casi seguro —es la única forma de agregar líneas—, así que se pide mientras
 * mira la pantalla y al hacer clic ya está en caché.
 *
 * `prefetchQuery` no reemplaza nada si la clave ya está fresca, así que
 * volver a entrar no dispara consultas de más.
 */
export function usePrecargarCatalogoDeDocumento(listaPrecioId: string | null, activo: boolean) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const esInterno = activa?.esInterno ?? false
  const qc = useQueryClient()

  useEffect(() => {
    if (!activo || companyId === null) return
    const plan = construirPlanDeConsulta(FILTROS_MODAL, companyId)
    void qc.prefetchQuery({
      queryKey: clavePagina(companyId, FILTROS_MODAL, listaPrecioId, esInterno),
      queryFn: () => consultarProductos(plan, listaPrecioId, esInterno),
      staleTime: 30_000,
      gcTime: 30 * 60_000,
    })
    void qc.prefetchQuery({
      queryKey: claveFacetas(companyId, FILTROS_MODAL),
      queryFn: () => obtenerFacetas(plan),
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
    })
  }, [activo, companyId, listaPrecioId, esInterno, qc])
}
