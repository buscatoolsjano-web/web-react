import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  actualizarMedicion,
  borrarMedicion,
  capacidadDeTorque,
  completarTorque,
  crearMedicion,
  guardarLimites,
  medicionesDeOrden,
} from '../services/torque'
import type { CapacidadTorque, DatosMedicion, LimitesTorque, Medicion } from '../types'

export function useMediciones(ordenId: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<Medicion[]>({
    queryKey: ['mantenimiento', companyId, 'mediciones', ordenId],
    queryFn: () => medicionesDeOrden(companyId!, ordenId!),
    enabled: companyId !== null && !!ordenId,
    staleTime: 30_000,
  })
}

/**
 * La capacidad.
 *
 * Se pide al servidor y no se calcula acá. `staleTime: 0` porque depende de
 * las mediciones: en cuanto cambia una, este número deja de valer.
 */
export function useCapacidad(ordenId: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<CapacidadTorque>({
    queryKey: ['mantenimiento', companyId, 'capacidad', ordenId],
    queryFn: () => capacidadDeTorque(ordenId!),
    enabled: companyId !== null && !!ordenId,
    staleTime: 0,
  })
}

export function useAccionesTorque(ordenId: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  // Tocar una medición cambia la capacidad, y completar el torque cambia la
  // orden y lo que el cierre va a contestar.
  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'mediciones', ordenId] })
    void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'capacidad', ordenId] })
    void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'precheck', ordenId] })
  }
  const invalidarOrden = () => {
    invalidar()
    void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'orden', ordenId] })
    void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'historial-orden', ordenId] })
  }

  return {
    crear: useMutation({
      mutationFn: (d: DatosMedicion) => crearMedicion(companyId!, ordenId, d),
      onSuccess: invalidar,
    }),
    actualizar: useMutation({
      mutationFn: ({ id, datos }: { id: string; datos: DatosMedicion }) =>
        actualizarMedicion(companyId!, id, datos),
      onSuccess: invalidar,
    }),
    borrar: useMutation({
      mutationFn: (id: string) => borrarMedicion(companyId!, id),
      onSuccess: invalidar,
    }),
    limites: useMutation({
      mutationFn: (l: LimitesTorque) => guardarLimites(companyId!, ordenId, l),
      onSuccess: invalidarOrden,
    }),
    completar: useMutation({
      mutationFn: (fecha: string | null) => completarTorque(companyId!, ordenId, fecha),
      onSuccess: invalidarOrden,
    }),
  }
}
