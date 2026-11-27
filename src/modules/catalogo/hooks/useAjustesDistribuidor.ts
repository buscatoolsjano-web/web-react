import { useQuery } from '@tanstack/react-query'
import { leerAjustesDistribuidor } from '../services/compartido'
import { AJUSTES_POR_DEFECTO, type AjustesDistribuidor } from '../lib/precioDistribuidor'

export const claveAjustesDistribuidor = (companyId: string | null) => ['distribuidor', companyId, 'precios-venta'] as const

/**
 * El margen y la moneda de venta del distribuidor (Fase 3). Se leen una vez y
 * se reusan en el catálogo, la ficha y el buscador de líneas. Sin fila, vende a
 * su costo y en la moneda del proveedor.
 */
export function useAjustesDistribuidor(companyId: string | null, habilitado = true): AjustesDistribuidor {
  const q = useQuery({
    queryKey: claveAjustesDistribuidor(companyId),
    queryFn: () => leerAjustesDistribuidor(companyId!),
    enabled: habilitado && companyId !== null,
    staleTime: 10 * 60_000,
  })
  return q.data ?? AJUSTES_POR_DEFECTO
}
