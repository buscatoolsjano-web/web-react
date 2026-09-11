import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  actualizarPunto,
  borrarPunto,
  crearPunto,
  listarPuntos,
  type DatosPunto,
} from '../services/checkPoints'
import type { PuntoDeRevision } from '../types'

/**
 * Los puntos de revisión de la empresa.
 *
 * `soloActivos` separa dos usos distintos: la pantalla de configuración los
 * quiere todos (para poder reactivar uno), y la orden sólo los activos (para
 * no ofrecer un punto que se sacó de circulación).
 */
export function usePuntos(soloActivos = false) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<PuntoDeRevision[]>({
    queryKey: ['mantenimiento', companyId, 'puntos', soloActivos],
    queryFn: () => listarPuntos(companyId!, soloActivos),
    enabled: companyId !== null,
    staleTime: 5 * 60_000,
  })
}

export function useEdicionDePuntos() {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  // Se invalidan las dos variantes: cambiar «activo» mueve una fila de una
  // lista a la otra.
  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'puntos'] })
  }

  return {
    crear: useMutation({
      mutationFn: (datos: DatosPunto) => crearPunto(companyId!, datos),
      onSuccess: invalidar,
    }),
    actualizar: useMutation({
      mutationFn: ({ id, datos }: { id: string; datos: Partial<DatosPunto> }) =>
        actualizarPunto(companyId!, id, datos),
      onSuccess: invalidar,
    }),
    borrar: useMutation({
      mutationFn: (id: string) => borrarPunto(companyId!, id),
      onSuccess: invalidar,
    }),
  }
}
