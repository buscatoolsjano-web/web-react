import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { construirPlanDeConsulta, hayBusqueda } from '../lib/planDeConsulta'
import {
  consultarProductos,
  obtenerProductoPorId,
  obtenerProductoPorSku,
  relacionadosDe,
  similaresDe,
} from '../services/productos'
import { obtenerDisponibilidad } from '../services/disponibilidad'
import { movimientosDeProducto } from '../services/movimientos'
import type {
  FiltrosCatalogo,
  PaginaDeProductos,
  ProductoDetalle,
  ProductoListado,
} from '../types'

/**
 * Una página del catálogo.
 *
 * Listado y búsqueda van por el MISMO camino desde la Fase 3.6: una sola
 * definición de qué productos entran, dentro de `search_products`. El
 * servidor devuelve como máximo `porPagina` filas: nunca se descarga el
 * catálogo entero.
 */
export function useProductos(
  filtros: FiltrosCatalogo,
  priceListId: string | null,
  /**
   * Si ya se sabe qué lista de precios corresponde.
   *
   * Sin esto la consulta salía dos veces: la primera con priceListId en
   * null —porque price_lists todavía no había respondido, y tarda ~1,4 s—
   * y otra al llegar la lista. Además de la request de más, sin filtro de
   * lista el embed devuelve TODAS las visibles, y `product_prices[0]` toma
   * una cualquiera: un usuario interno, que ve tres listas, podía ver
   * durante ese rato un precio que no es el de la lista elegida.
   */
  listaResuelta: boolean,
) {
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
    queryFn: () =>
      consultarProductos(
        construirPlanDeConsulta(filtros, companyId!),
        priceListId,
        esInterno,
      ),
    enabled: companyId !== null && listaResuelta,
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

export function useProducto(
  sku: string | undefined,
  priceListId: string | null,
  listaResuelta: boolean,
) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const esInterno = activa?.esInterno ?? false

  return useQuery<ProductoDetalle | null>({
    queryKey: ['catalogo', companyId, 'producto', sku, priceListId, esInterno],
    queryFn: () => obtenerProductoPorSku(companyId!, sku!, priceListId, esInterno),
    enabled: companyId !== null && !!sku && listaResuelta,
    staleTime: 30_000,
  })
}

/**
 * El producto del modal, por uuid (Fase 21 · E1).
 *
 * La clave incluye la lista de precios: el modal tiene que mostrar el precio
 * de la lista que está elegida en el catálogo, y cambiar de lista tiene que
 * cambiar el número —no quedarse con el de la lista anterior porque el
 * producto «ya estaba cacheado».
 */
export function useProductoPorId(
  id: string | null,
  priceListId: string | null,
  listaResuelta: boolean,
) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const esInterno = activa?.esInterno ?? false

  return useQuery<ProductoDetalle | null>({
    queryKey: ['catalogo', companyId, 'producto-id', id, priceListId, esInterno],
    queryFn: () => obtenerProductoPorId(companyId!, id!, priceListId, esInterno),
    enabled: companyId !== null && id !== null && listaResuelta,
    staleTime: 60_000,
  })
}

/**
 * Los hermanos del producto: misma marca, serie y tipo.
 *
 * Se piden **sólo cuando hay un producto abierto**, nunca por fila del
 * listado. Con `staleTime` largo: la familia de un producto no cambia
 * mientras alguien la mira.
 */
export function useRelacionados(
  producto: ProductoDetalle | null | undefined,
  priceListId: string | null,
) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<ProductoListado[]>({
    queryKey: ['catalogo', companyId, 'relacionados', producto?.id, priceListId],
    queryFn: () => relacionadosDe(companyId!, producto!, priceListId),
    enabled: companyId !== null && !!producto,
    staleTime: 5 * 60_000,
  })
}

/**
 * El historial de stock del producto abierto.
 *
 * `enabled` lo controla quien llama: se pide cuando la sección se abre, no
 * cuando se abre el producto.
 */
export function useMovimientos(productId: string | null, habilitado: boolean, limite = 15) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery({
    queryKey: ['catalogo', companyId, 'movimientos', productId, limite],
    queryFn: () => movimientosDeProducto(companyId!, productId!, limite),
    enabled: companyId !== null && productId !== null && habilitado,
    staleTime: 60_000,
  })
}

/**
 * Los similares de un producto (Fase 22 · Etapa B).
 *
 * `habilitado` lo decide quien llama, y es importante: el hover lo enciende
 * **después** del retardo, no al entrar el mouse. Recorrer cincuenta filas a
 * toda velocidad no dispara cincuenta búsquedas; dispara las de los productos
 * en los que uno se detuvo de verdad.
 *
 * Una vez pedidos quedan en caché mientras dure la sesión de la pantalla: el
 * mismo producto no se vuelve a buscar, ni en el hover ni al abrir el modal,
 * porque la clave es la misma.
 */
export function useSimilares(
  productId: string | null,
  priceListId: string | null,
  habilitado: boolean,
  limite = 6,
) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const esInterno = activa?.esInterno ?? false

  return useQuery<ProductoListado[]>({
    queryKey: ['catalogo', companyId, 'similares', productId, priceListId, esInterno, limite],
    queryFn: () => similaresDe(companyId!, productId!, priceListId, esInterno, limite),
    enabled: companyId !== null && productId !== null && habilitado,
    staleTime: 10 * 60_000,
  })
}
