import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  actualizarProveedor,
  crearProveedor,
  darDeBajaProveedor,
  reactivarProveedor,
  resolverRevision,
} from '../services/edicion'
import type { DatosProveedor } from '../lib/validacion'

/**
 * Las mutaciones del maestro de proveedores.
 *
 * Cada una invalida lo que dejó viejo y nada más. Todas invalidan también el
 * historial: el alta, la edición y el cambio de estado escriben en
 * `purchases_audit`, así que la pestaña Historial quedó desactualizada.
 */
function claves(companyId: string | null, id?: string) {
  return {
    listado: ['compras', companyId, 'proveedores'] as const,
    detalle: ['compras', companyId, 'proveedor', id] as const,
    historial: ['compras', companyId, 'historial-proveedor', id] as const,
    formasDePago: ['compras', companyId, 'formas-de-pago'] as const,
  }
}

export function useCrearProveedor() {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  return useMutation({
    mutationFn: (datos: DatosProveedor) => crearProveedor(companyId!, datos),
    onSuccess: () => {
      const k = claves(companyId)
      void qc.invalidateQueries({ queryKey: k.listado })
      void qc.invalidateQueries({ queryKey: k.formasDePago })
    },
  })
}

export function useActualizarProveedor(id: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  return useMutation({
    mutationFn: (datos: DatosProveedor) => actualizarProveedor(companyId!, id, datos),
    onSuccess: () => {
      const k = claves(companyId, id)
      void qc.invalidateQueries({ queryKey: k.detalle })
      void qc.invalidateQueries({ queryKey: k.listado })
      void qc.invalidateQueries({ queryKey: k.historial })
      void qc.invalidateQueries({ queryKey: k.formasDePago })
    },
  })
}

export function useBajaProveedor(id: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  const invalidar = () => {
    const k = claves(companyId, id)
    void qc.invalidateQueries({ queryKey: k.detalle })
    void qc.invalidateQueries({ queryKey: k.listado })
    void qc.invalidateQueries({ queryKey: k.historial })
  }

  return {
    dar: useMutation({
      mutationFn: () => darDeBajaProveedor(companyId!, id),
      onSuccess: invalidar,
    }),
    reactivar: useMutation({
      mutationFn: () => reactivarProveedor(companyId!, id),
      onSuccess: invalidar,
    }),
  }
}

export function useResolverRevisionProveedor(id: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  return useMutation({
    mutationFn: () => resolverRevision(companyId!, id),
    onSuccess: () => {
      const k = claves(companyId, id)
      void qc.invalidateQueries({ queryKey: k.detalle })
      void qc.invalidateQueries({ queryKey: k.listado })
      void qc.invalidateQueries({ queryKey: k.historial })
    },
  })
}
