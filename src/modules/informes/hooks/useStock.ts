import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { armarCatalogo, armarResumenStock } from '../lib/stock'
import { ErrorInforme } from '../services/actividad'
import { obtenerCatalogoStock, obtenerKardex, obtenerMovimientos, obtenerResumenStock, obtenerStock } from '../services/stock'
import type { CatalogoStock, FilaKardex, FilaMovimiento, FilaStock, FiltrosMovimientos, FiltrosStock, ResumenStock } from '../types'

const OPCIONES = {
  // Sin polling ni refetch por foco: el stock se consulta al abrir, al filtrar
  // o con «Actualizar».
  staleTime: 60_000,
  refetchOnWindowFocus: false,
  retry: (intentos: number, error: Error) => !(error instanceof ErrorInforme && error.codigo !== 'desconocido') && intentos < 2,
} as const

export const POR_PAGINA_STOCK = 50

export function useResumenStock(mes: string | null) {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery<ResumenStock>({
    queryKey: ['informes', companyId, 'stock', 'resumen', mes ?? 'actual'],
    queryFn: async () => armarResumenStock(await obtenerResumenStock(companyId!, mes)),
    enabled: companyId !== null,
    // Al cambiar de mes no se desmonta la vista: la tabla y el kardex conservan sus filtros.
    placeholderData: keepPreviousData,
    ...OPCIONES,
  })
}

/** El conteo del catálogo recorre 21.772 productos bajo RLS: se cachea más tiempo. */
export function useCatalogoStock() {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery<CatalogoStock>({
    queryKey: ['informes', companyId, 'stock', 'catalogo'],
    queryFn: async () => armarCatalogo(await obtenerCatalogoStock(companyId!)),
    enabled: companyId !== null,
    ...OPCIONES,
    staleTime: 30 * 60_000,
  })
}

export function useStockActual(f: FiltrosStock, pagina: number, habilitado = true) {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery<FilaStock[]>({
    queryKey: ['informes', companyId, 'stock', 'actual', f.busqueda.trim(), f.deposito, f.estado, pagina],
    queryFn: () => obtenerStock(companyId!, f, POR_PAGINA_STOCK, pagina * POR_PAGINA_STOCK),
    enabled: companyId !== null && habilitado,
    placeholderData: keepPreviousData,
    ...OPCIONES,
  })
}

export function useMovimientosStock(mes: string | null, f: FiltrosMovimientos, pagina: number) {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery<FilaMovimiento[]>({
    queryKey: ['informes', companyId, 'stock', 'movimientos', mes ?? 'actual', f.deposito, f.tipo, f.sentido, pagina],
    queryFn: () => obtenerMovimientos(companyId!, mes, f, POR_PAGINA_STOCK, pagina * POR_PAGINA_STOCK),
    enabled: companyId !== null,
    placeholderData: keepPreviousData,
    ...OPCIONES,
  })
}

export function useKardex(productoId: string | null, deposito: string | null, orden: 'asc' | 'desc', pagina: number) {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery<FilaKardex[]>({
    queryKey: ['informes', companyId, 'stock', 'kardex', productoId, deposito, orden, pagina],
    queryFn: () => obtenerKardex(companyId!, productoId!, deposito, orden, POR_PAGINA_STOCK, pagina * POR_PAGINA_STOCK),
    enabled: companyId !== null && productoId !== null,
    placeholderData: keepPreviousData,
    ...OPCIONES,
  })
}

/**
 * Los filtros con los que abren la tabla y los movimientos.
 *
 * Están acá, y no como literales dentro de cada componente, porque
 * `usePrecargaStock` tiene que pedir EXACTAMENTE los mismos VALORES. La clave
 * de TanStack Query se arma con los escalares, así que repetir el literal no
 * rompe nada; lo que rompe es cambiar un valor en un lado y no en el otro:
 * ahí la precarga deja de deduplicar y pasa a ser una consulta de más, en
 * silencio. Con una sola constante eso no se puede escribir.
 */
export const FILTROS_STOCK_INICIALES: FiltrosStock = { busqueda: '', deposito: null, estado: null }
export const FILTROS_MOVIMIENTOS_INICIALES: FiltrosMovimientos = { deposito: null, tipo: null, sentido: null }

/**
 * Arranca las consultas que NO dependen del resumen, sin esperarlo.
 *
 * La pantalla monta la tabla, los movimientos y el conteo del catálogo recién
 * cuando el resumen contesta, porque les pasa los depósitos por prop. Pero
 * ninguna de las tres necesita el resumen para salir: sólo para dibujar los
 * desplegables. Esperarlo costaba una cascada —medido en carga fría: el
 * resumen arrancaba a los 0,9 s y las otras tres a los 1,6 s, con el último
 * dato a los 3,5 s—.
 *
 * Pidiéndolas acá salen las cuatro juntas. Los componentes siguen llamando a
 * sus hooks como antes y leen la misma entrada de caché: misma clave, misma
 * consulta, sin pedidos de más.
 */
export function usePrecargaStock(mes: string | null) {
  useCatalogoStock()
  useStockActual(FILTROS_STOCK_INICIALES, 0)
  useMovimientosStock(mes, FILTROS_MOVIMIENTOS_INICIALES, 0)
}
