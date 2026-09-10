import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { actividadMensual, resumenDeCliente, totalesPorMonedaYTipo } from '../services/resumen'
import type { ActividadMensual, ResumenCliente, TotalPorMonedaYTipo } from '../types'

/**
 * El panel rápido. Tres consultas separadas y no una sola gorda: la cabecera
 * de números se pinta apenas llega, y el gráfico —que es lo más caro— no la
 * hace esperar.
 */

export function useResumenCliente(clienteId: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<ResumenCliente | null>({
    queryKey: ['clientes', companyId, 'resumen', clienteId],
    queryFn: () => resumenDeCliente(clienteId!),
    enabled: companyId !== null && !!clienteId,
    staleTime: 60_000,
  })
}

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

export function useActividadMensual(clienteId: string | undefined, meses = 12) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<ActividadMensual[]>({
    queryKey: ['clientes', companyId, 'actividad', clienteId, meses],
    queryFn: () => actividadMensual(clienteId!, meses),
    enabled: companyId !== null && !!clienteId,
    staleTime: 60_000,
  })
}
