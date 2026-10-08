import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import type { PvpDeProducto } from '../lib/pvp'
import { pvpDeProducto, pvpDeProductos } from '../services/pvp'

/**
 * El PVP calculado de un producto (Fase 51).
 *
 * Se pide aparte y no dentro de `useProducto` por una razón concreta: la
 * consulta del producto la comparte el rol externo, y el costo no es suyo. Una
 * consulta separada hace que el dato simplemente no se pida cuando no
 * corresponde, en vez de depender de que la RLS lo recorte.
 *
 * `staleTime` largo: el costo cambia cuando entra una lista nueva, o sea una
 * vez cada varios meses. No hay nada que refrescar cada medio minuto.
 */
export function usePvpDeProducto(productId: string | null) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const esInterno = activa?.esInterno ?? false

  return useQuery<PvpDeProducto | null>({
    queryKey: ['catalogo', companyId, 'pvp', productId],
    queryFn: () => pvpDeProducto(companyId!, productId!),
    enabled: companyId !== null && productId !== null && esInterno,
    staleTime: 30 * 60_000,
  })
}

/** El PVP de varios, para una pantalla que muestra una lista. */
export function usePvpDeProductos(ids: readonly string[]) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const esInterno = activa?.esInterno ?? false

  // Ordenados para la clave: el mismo conjunto en otro orden es la misma
  // consulta, y sin esto cada reordenamiento sería un viaje más a São Paulo.
  const clave = [...ids].sort().join(',')

  return useQuery<Map<string, PvpDeProducto>>({
    queryKey: ['catalogo', companyId, 'pvp', 'varios', clave],
    queryFn: () => pvpDeProductos(companyId!, ids),
    enabled: companyId !== null && ids.length > 0 && esInterno,
    staleTime: 30 * 60_000,
    placeholderData: (previa) => previa,
  })
}
