import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  cerrarOrden,
  guardarDiagnostico,
  guardarEntrega,
  guardarReparacion,
  precheckCierre,
} from '../services/cierre'
import type { PrecheckCierre } from '../types'

/**
 * Qué falta para cerrar.
 *
 * Sale de la misma función del servidor que usa el cierre, así que la pantalla
 * nunca puede decir «lista para cerrar» sobre una regla que la base ve de otra
 * manera. `staleTime: 0`: cualquier cosa que se toque en la orden cambia la
 * respuesta.
 */
export function usePrecheckCierre(ordenId: string | undefined, activo: boolean) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<PrecheckCierre>({
    queryKey: ['mantenimiento', companyId, 'precheck', ordenId],
    queryFn: () => precheckCierre(ordenId!),
    enabled: companyId !== null && !!ordenId && activo,
    staleTime: 0,
  })
}

export function useAccionesCierre(ordenId: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'orden', ordenId] })
    void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'precheck', ordenId] })
    void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'historial-orden', ordenId] })
    void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'ordenes'] })
  }

  return {
    diagnostico: useMutation({
      mutationFn: (d: { notas?: string | null; completadoEn?: string | null }) =>
        guardarDiagnostico(companyId!, ordenId, d),
      onSuccess: invalidar,
    }),
    reparacion: useMutation({
      mutationFn: (d: { notas?: string | null; completadaEn?: string | null; horas?: number | null }) =>
        guardarReparacion(companyId!, ordenId, d),
      onSuccess: invalidar,
    }),
    entrega: useMutation({
      mutationFn: (fecha: string | null) => guardarEntrega(companyId!, ordenId, fecha),
      onSuccess: invalidar,
    }),
    cerrar: useMutation({
      mutationFn: () => cerrarOrden(ordenId),
      onSuccess: () => {
        invalidar()
        // Cerrar congela todo: lo que esté cacheado de esta orden ya no es
        // editable y conviene releerlo.
        void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'cotizacion', ordenId] })
        void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'repuestos', ordenId] })
        void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'mediciones', ordenId] })
      },
    }),
  }
}
