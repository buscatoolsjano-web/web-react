import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { armarActividad } from '../lib/actividad'
import { armarPipeline } from '../lib/pipeline'
import { ErrorInforme, obtenerActividad, obtenerPipeline } from '../services/actividad'
import { obtenerRanking } from '../services/rankings'
import {
  obtenerDocumentosInforme,
  obtenerFacetasDocumentos,
  type FacetaDocumentos,
  type FiltrosDocumentosInforme,
  type PaginaDocumentosInforme,
} from '../services/documentos'
import type { ActividadComercial, FilaRanking, ParametrosRanking, PipelineComercial } from '../types'

export const clavesInformes = {
  actividad: (companyId: string | null, mes: string | null) => ['informes', companyId, 'actividad', mes ?? 'actual'] as const,
  pipeline: (companyId: string | null, mes: string | null) => ['informes', companyId, 'pipeline', mes ?? 'actual'] as const,
  ranking: (companyId: string | null, mes: string | null, p: ParametrosRanking) =>
    ['informes', companyId, 'ranking', mes ?? 'actual', p.dimension, p.fuente, p.medida, p.periodo, p.moneda] as const,
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

/** Top N del ranking. Deshabilitado mientras la combinación no tenga moneda (importe sin monedas disponibles). */
export function useRanking(mes: string | null, p: ParametrosRanking, limite: number) {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery<FilaRanking[]>({
    queryKey: [...clavesInformes.ranking(companyId, mes, p), limite],
    queryFn: () => obtenerRanking(companyId!, mes, p, limite),
    enabled: companyId !== null && (p.medida === 'cantidad' || p.moneda !== null),
    ...OPCIONES,
  })
}

/**
 * Los documentos que forman un KPI, o la sección DOCUMENTOS (Fase 21 · E3).
 *
 * El mismo hook para las dos cosas porque es la misma pregunta con distintos
 * filtros: «qué documentos hay en este universo». Separarlos era la forma de
 * que la sección y el drill-down empezaran a contar distinto.
 */
export function useDocumentosInforme(
  f: FiltrosDocumentosInforme | null,
  pagina: number,
  porPagina = 50,
  habilitado = true,
) {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery<PaginaDocumentosInforme>({
    queryKey: ['informes', companyId, 'documentos', f, pagina, porPagina],
    queryFn: () => obtenerDocumentosInforme(companyId!, f!, porPagina, (pagina - 1) * porPagina),
    enabled: companyId !== null && f !== null && habilitado,
    placeholderData: keepPreviousData,
    ...OPCIONES,
  })
}

/** Los valores que EXISTEN para filtrar, no una lista escrita a mano. */
export function useFacetasDocumentos(desde: string | null, hasta: string | null, tipo: string | null, moneda: string | null) {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery<FacetaDocumentos[]>({
    queryKey: ['informes', companyId, 'facetas-documentos', desde, hasta, tipo, moneda],
    queryFn: () => obtenerFacetasDocumentos(companyId!, desde!, hasta!, tipo, moneda),
    enabled: companyId !== null && desde !== null && hasta !== null,
    ...OPCIONES,
  })
}
