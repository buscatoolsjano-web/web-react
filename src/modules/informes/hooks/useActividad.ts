import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { armarActividad } from '../lib/actividad'
import { ErrorInforme, obtenerActividad } from '../services/actividad'
import type { ActividadComercial } from '../types'

export const clavesInformes = {
  actividad: (companyId: string | null, mes: string | null) => ['informes', companyId, 'actividad', mes ?? 'actual'] as const,
}

export function useActividad(mes: string | null) {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery<ActividadComercial>({
    queryKey: clavesInformes.actividad(companyId, mes),
    queryFn: async () => armarActividad(await obtenerActividad(companyId!, mes)),
    enabled: companyId !== null,
    // Un informe no cambia de un segundo a otro: sin refetch por foco.
    // «Actualizar» lo pide explícitamente.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    // Sin permiso o mes futuro no se arreglan reintentando.
    retry: (intentos, error) => !(error instanceof ErrorInforme && error.codigo !== 'desconocido') && intentos < 2,
  })
}
