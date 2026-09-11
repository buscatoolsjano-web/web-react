import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  actualizarRepuesto,
  agregarRepuesto,
  borrarRepuesto,
  confirmarConsumo,
  depositosActivos,
  repuestosDeOrden,
} from '../services/repuestos'
import type { DatosRepuesto, Deposito, RepuestoDeOrden } from '../types'

export function useRepuestosDeOrden(ordenId: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<RepuestoDeOrden[]>({
    queryKey: ['mantenimiento', companyId, 'repuestos', ordenId],
    queryFn: () => repuestosDeOrden(companyId!, ordenId!),
    enabled: companyId !== null && !!ordenId,
    staleTime: 30_000,
  })
}

export function useDepositos() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<Deposito[]>({
    queryKey: ['mantenimiento', companyId, 'depositos'],
    queryFn: () => depositosActivos(companyId!),
    enabled: companyId !== null,
    staleTime: 5 * 60_000,
  })
}

export function useAccionesRepuestos(ordenId: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'repuestos', ordenId] })
    void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'historial-orden', ordenId] })
  }

  return {
    agregar: useMutation({
      mutationFn: (datos: DatosRepuesto) => agregarRepuesto(companyId!, ordenId, datos),
      onSuccess: invalidar,
    }),
    actualizar: useMutation({
      mutationFn: ({ id, datos }: { id: string; datos: DatosRepuesto }) =>
        actualizarRepuesto(companyId!, id, datos),
      onSuccess: invalidar,
    }),
    borrar: useMutation({
      mutationFn: (id: string) => borrarRepuesto(companyId!, id),
      onSuccess: invalidar,
    }),
    // Confirmar el consumo mueve stock: además de los repuestos hay que
    // invalidar lo que muestre saldos en otras pantallas.
    consumir: useMutation({
      mutationFn: () => confirmarConsumo(ordenId),
      onSuccess: () => {
        invalidar()
        void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId, 'orden', ordenId] })
        void qc.invalidateQueries({ queryKey: ['catalogo'] })
      },
    }),
  }
}
