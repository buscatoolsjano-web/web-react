import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { armarActividad } from '../lib/actividad'
import { armarPipeline } from '../lib/pipeline'
import { ErrorInforme, obtenerActividad, obtenerPipeline } from '../services/actividad'
import type { ActividadComercial, PipelineComercial } from '../types'

export const clavesInformes = {
  actividad: (companyId: string | null, mes: string | null) => ['informes', companyId, 'actividad', mes ?? 'actual'] as const,
  pipeline: (companyId: string | null, mes: string | null) => ['informes', companyId, 'pipeline', mes ?? 'actual'] as const,
}

const OPCIONES = {
  // Un informe no cambia de un segundo a otro: sin refetch por foco.
  // «Actualizar» lo pide explícitamente.
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: false,
  // Sin permiso o mes futuro no se arreglan reintentando.
  retry: (intentos: number, error: Error) => !(error instanceof ErrorInforme && error.codigo !== 'desconocido') && intentos < 2,
} as const

export function useActividad(mes: string | null) {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery<ActividadComercial>({
    queryKey: clavesInformes.actividad(companyId, mes),
    queryFn: async () => armarActividad(await obtenerActividad(companyId!, mes)),
    enabled: companyId !== null,
    ...OPCIONES,
  })
}

/** Pipeline, conversión y cumplimiento: otra RPC, en paralelo con la actividad. */
export function usePipeline(mes: string | null) {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery<PipelineComercial>({
    queryKey: clavesInformes.pipeline(companyId, mes),
    queryFn: async () => armarPipeline(await obtenerPipeline(companyId!, mes)),
    enabled: companyId !== null,
    ...OPCIONES,
  })
}
