import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  ErrorPermisos,
  guardarPermisosDeRol,
  listarCapacidades,
  listarConcesiones,
} from '../services/permisos'
import type { Capacidad, Concesion } from '../lib/capacidades'

export const clavesPermisos = {
  catalogo: () => ['configuracion', 'capacidades'] as const,
  concesiones: (companyId: string | null) => ['configuracion', companyId, 'permisos-rol'] as const,
}

/** El catálogo de permisos. Lo cambia una migración, así que casi nunca. */
export function useCapacidades() {
  return useQuery<Capacidad[]>({
    queryKey: clavesPermisos.catalogo(),
    queryFn: listarCapacidades,
    staleTime: 30 * 60_000,
  })
}

export function useConcesiones() {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery<Concesion[]>({
    queryKey: clavesPermisos.concesiones(companyId),
    queryFn: () => listarConcesiones(companyId!),
    enabled: companyId !== null,
    // Sin permiso no se arregla reintentando.
    retry: (intentos, error) =>
      !(error instanceof ErrorPermisos && error.codigo === 'sin_permiso') && intentos < 1,
  })
}

export function useGuardarPermisos() {
  const qc = useQueryClient()
  const companyId = useEmpresa().activa?.companyId ?? null

  return useMutation({
    mutationFn: (v: { rol: string; capacidades: readonly string[] }) =>
      guardarPermisosDeRol(companyId!, v.rol, v.capacidades),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: clavesPermisos.concesiones(companyId) })
      /*
       * Y las capacidades DE QUIEN ESTÁ MIRANDO, que son las que deciden el
       * menú. Un admin no se cambia las propias —tiene todas siempre— pero si
       * se bajó el rol a sí mismo en otra pestaña, o si quien mira es admin de
       * una empresa y empleado de otra, lo que puede hacer acaba de cambiar.
       */
      await qc.invalidateQueries({ queryKey: ['empresa', 'capacidades'] })
    },
  })
}
