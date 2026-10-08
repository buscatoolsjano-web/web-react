import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { cambiosDeVersion, listarFuentes, listarVersiones, planillaDePrecios } from '../services/listas'

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

/**
 * La planilla de una marca (Fase 50).
 *
 * `keepPreviousData` para que al pasar de página o al escribir en el buscador
 * la tabla no parpadee a vacío: con miles de referencias, ese parpadeo en
 * cada tecla es lo que vuelve inusable un listado.
 */
export function usePlanillaDePrecios(
  sourceId: string | null,
  opciones: { texto?: string; pagina?: number; porPagina?: number } = {},
) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const { texto = '', pagina = 1, porPagina = 25 } = opciones
  return useQuery({
    queryKey: ['precios', companyId, 'planilla', sourceId, texto, pagina, porPagina],
    queryFn: () => planillaDePrecios(companyId!, sourceId!, { texto, pagina, porPagina }),
    enabled: companyId !== null && sourceId !== null,
    placeholderData: keepPreviousData,
    staleTime: MEDIA_HORA,
  })
}
