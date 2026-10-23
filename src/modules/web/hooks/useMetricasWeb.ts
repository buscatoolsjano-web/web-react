import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { metricasWeb } from '../services/metricas'

/** Las métricas de la web de la empresa activa, para un rango de fechas (Fase 115). */
export function useMetricasWeb(desde: string, hasta: string) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  return useQuery({
    queryKey: ['web', companyId, 'metricas', desde, hasta],
    queryFn: () => metricasWeb(companyId!, desde, hasta),
    enabled: companyId !== null,
    staleTime: 60_000,
  })
}
