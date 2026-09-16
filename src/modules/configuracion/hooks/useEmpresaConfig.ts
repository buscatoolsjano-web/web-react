import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { autoridadPorSerie, diagnosticoNumeracion, estadoSyncStel } from '../services/numeracion'
import { ErrorEmpresa, actualizarEmpresa, obtenerEmpresa, quitarLogo, subirLogo, urlLogo } from '../services/empresa'
import type { CampoEditable } from '../lib/empresa'

export const clavesEmpresa = {
  datos: (companyId: string | null) => ['configuracion', companyId, 'empresa'] as const,
  logo: (path: string | null) => ['configuracion', 'logo', path] as const,
  numeracion: (companyId: string | null) => ['configuracion', companyId, 'numeracion'] as const,
  syncStel: (companyId: string | null) => ['configuracion', companyId, 'sync-stel'] as const,
  autoridadSeries: (companyId: string | null) => ['configuracion', companyId, 'autoridad-series'] as const,
}

const sinReintentoPorPermiso = (intentos: number, error: Error) =>
  !(error instanceof ErrorEmpresa && error.codigo === 'sin_permiso') && error.message !== 'sin_permiso' && intentos < 1

export function useDatosEmpresa() {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery({
    queryKey: clavesEmpresa.datos(companyId),
    queryFn: () => obtenerEmpresa(companyId!),
    enabled: companyId !== null,
    // Datos de un formulario: no se refrescan solos mientras alguien edita.
    staleTime: Infinity,
    retry: sinReintentoPorPermiso,
  })
}

export function useUrlLogo(path: string | null) {
  return useQuery({
    queryKey: clavesEmpresa.logo(path),
    queryFn: () => urlLogo(path!),
    enabled: path !== null,
    // La URL firmada dura 10 minutos: se renueva antes.
    staleTime: 8 * 60_000,
    retry: false,
  })
}

export function useNumeracion() {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery({
    queryKey: clavesEmpresa.numeracion(companyId),
    queryFn: () => diagnosticoNumeracion(companyId!),
    enabled: companyId !== null,
    staleTime: 60_000,
    retry: sinReintentoPorPermiso,
  })
}

/**
 * Estado del sync con STEL (Fase 14 E4). Sólo lo devuelve la base para admin;
 * para el resto de los roles la consulta falla con `sin_permiso` y la pantalla
 * simplemente no muestra la sección.
 */
export function useSyncStel() {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery({
    queryKey: clavesEmpresa.syncStel(companyId),
    queryFn: () => estadoSyncStel(companyId!),
    enabled: companyId !== null,
    staleTime: 60_000,
    retry: sinReintentoPorPermiso,
  })
}

/**
 * Excepciones de autoridad por serie (Fase 14 E5). Si falla, la pantalla sigue
 * mostrando la autoridad por tipo: no se rompe por una consulta de más.
 */
export function useAutoridadSeries() {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery({
    queryKey: clavesEmpresa.autoridadSeries(companyId),
    queryFn: () => autoridadPorSerie(companyId!),
    enabled: companyId !== null,
    staleTime: 60_000,
    retry: sinReintentoPorPermiso,
  })
}

export function useAccionesEmpresa() {
  const qc = useQueryClient()
  const companyId = useEmpresa().activa?.companyId ?? null
  const refrescarSelector = () => qc.invalidateQueries({ queryKey: ['empresa', 'membresias'] })

  return {
    guardar: useMutation({
      mutationFn: (v: { version: string; datos: Partial<Record<CampoEditable, string | null>> }) =>
        actualizarEmpresa(companyId!, v.version, v.datos),
      // El nombre comercial se ve en el selector de empresa del encabezado.
      onSuccess: refrescarSelector,
    }),
    subirLogo: useMutation({
      mutationFn: (v: { version: string; archivo: File }) => subirLogo(companyId!, v.version, v.archivo),
    }),
    quitarLogo: useMutation({
      mutationFn: (v: { version: string }) => quitarLogo(companyId!, v.version),
    }),
    recargar: () => qc.invalidateQueries({ queryKey: clavesEmpresa.datos(companyId) }),
  }
}
