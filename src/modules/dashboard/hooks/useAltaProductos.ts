import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { saludAltaProductos } from '../services/altaProductos'

export function useAltaProductos() {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery({
    queryKey: ['dashboard', companyId, 'alta-productos'],
    queryFn: () => saludAltaProductos(companyId!),
    enabled: companyId !== null,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}
