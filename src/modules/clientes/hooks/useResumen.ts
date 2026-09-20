import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { totalesPorMonedaYTipo } from '../services/resumen'
import type { TotalPorMonedaYTipo } from '../types'

/**
 * El panel rápido. Tres consultas separadas y no una sola gorda: la cabecera
 * de números se pinta apenas llega, y el gráfico —que es lo más caro— no la
 * hace esperar.
 */

export function useTotalesPorMoneda(clienteId: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<TotalPorMonedaYTipo[]>({
    queryKey: ['clientes', companyId, 'totales-moneda', clienteId],
    queryFn: () => totalesPorMonedaYTipo(clienteId!),
    enabled: companyId !== null && !!clienteId,
    staleTime: 60_000,
  })
}
