import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { construirPlanDeConsulta, hayBusqueda } from '../lib/planDeConsulta'
import { buscarProductos, listarProductos, obtenerProductoPorSku } from '../services/productos'
import { obtenerDisponibilidad } from '../services/disponibilidad'
import type { FiltrosCatalogo, PaginaDeProductos, ProductoDetalle } from '../types'

/**
 * Una página del catálogo.
 *
 * Según haya texto de búsqueda o no, usa la RPC (fuzzy + ranking) o el
 * listado normal. En los dos casos el servidor devuelve como máximo
 * `porPagina` filas: nunca se descarga el catálogo entero.
 */
export function useProductos(filtros: FiltrosCatalogo, priceListId: string | null) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const esInterno = activa?.esInterno ?? false
  const texto = filtros.q.trim()
  const buscando = hayBusqueda(filtros)

  return useQuery<PaginaDeProductos>({
    // companyId primero, y priceListId adentro: dos empresas o dos listas
    // nunca comparten entrada de caché.
    queryKey: [
      'catalogo',
      companyId,
      'productos',
      { ...filtros, q: buscando ? texto : '' },
      priceListId,
      esInterno,
    ],
    queryFn: () => {
      const plan = construirPlanDeConsulta(filtros, companyId!)
      return buscando
        ? buscarProductos(plan, texto, priceListId, esInterno)
        : listarProductos(plan, priceListId, esInterno)
    },
    enabled: companyId !== null,
    // Mantener la página anterior visible mientras carga la siguiente evita
    // que la tabla salte a "vacío" y vuelva al paginar o filtrar.
    //
    // PERO SÓLO DENTRO DE LA MISMA EMPRESA. `placeholderData` recibe los
    // datos de la consulta previa aunque la clave haya cambiado, así que
    // sin este control anulaba el removeQueries del cambio de empresa:
    // medido en producción, las 50 filas de Buscatools seguían en pantalla
    // entre 150 y 300 ms bajo el cartel de Torquetools.
    //
    // La clave es ['catalogo', companyId, 'productos', ...]; comparar la
    // posición 1 alcanza para saber si es la misma empresa.
    placeholderData: (previa, consultaPrevia) => {
      const empresaPrevia = consultaPrevia?.queryKey[1]
      return empresaPrevia === companyId ? previa : undefined
    },
    staleTime: 30_000,
  })
}

/**
 * Disponibilidad de los productos de la página actual.
 *
 * Sólo se dispara para roles externos. Un interno ya recibió las cantidades
 * reales en la consulta principal y no necesita este request.
 */
export function useDisponibilidad(productIds: readonly string[]) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const esExterno = activa !== null && !activa.esInterno

  return useQuery({
    queryKey: ['catalogo', companyId, 'disponibilidad', [...productIds].sort()],
    queryFn: () => obtenerDisponibilidad(companyId!, productIds),
    enabled: esExterno && companyId !== null && productIds.length > 0,
    staleTime: 30_000,
  })
}

export function useProducto(sku: string | undefined, priceListId: string | null) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const esInterno = activa?.esInterno ?? false

  return useQuery<ProductoDetalle | null>({
    queryKey: ['catalogo', companyId, 'producto', sku, priceListId, esInterno],
    queryFn: () => obtenerProductoPorSku(companyId!, sku!, priceListId, esInterno),
    enabled: companyId !== null && !!sku,
    staleTime: 30_000,
  })
}
