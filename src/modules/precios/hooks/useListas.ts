import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { cambiosDeVersion, listarFuentes, listarVersiones } from '../services/listas'

/**
 * Las consultas de Listas de precios (Fase 49).
 *
 * `staleTime` largo a propósito: una lista de precios cambia cuando llega un
 * archivo nuevo, o sea una vez por mes en el mejor de los casos. Refrescarla
 * cada vez que alguien vuelve a la pestaña es gastar viajes contra São Paulo
 * —220 ms cada uno desde acá— para traer exactamente lo mismo.
 */
const MEDIA_HORA = 30 * 60_000

export function useFuentesDeListas() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  return useQuery({
    queryKey: ['precios', companyId, 'fuentes'],
    queryFn: () => listarFuentes(companyId!),
    enabled: companyId !== null,
    staleTime: MEDIA_HORA,
  })
}

export function useVersionesDeLista(sourceId: string | null) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  return useQuery({
    queryKey: ['precios', companyId, 'versiones', sourceId],
    queryFn: () => listarVersiones(companyId!, sourceId!),
    enabled: companyId !== null && sourceId !== null,
    staleTime: MEDIA_HORA,
  })
}

export function useCambiosDeVersion(versionId: string | null) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  return useQuery({
    queryKey: ['precios', companyId, 'cambios', versionId],
    queryFn: () => cambiosDeVersion(companyId!, versionId!),
    enabled: companyId !== null && versionId !== null,
    staleTime: MEDIA_HORA,
  })
}
