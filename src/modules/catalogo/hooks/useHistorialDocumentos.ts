import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { historialDocumentosDeProducto } from '../services/historialDocumentos'

/**
 * El histórico comercial del producto abierto (Fase 113).
 *
 * `habilitado` lo controla quien llama: se pide cuando la sección se abre, no
 * cuando se abre el producto —igual que el historial de stock—.
 */
export function useHistorialDocumentos(productId: string | null, habilitado: boolean) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  return useQuery({
    queryKey: ['catalogo', companyId, 'historial-docs', productId],
    queryFn: () => historialDocumentosDeProducto(productId!),
    enabled: productId !== null && habilitado,
    staleTime: 60_000,
  })
}
