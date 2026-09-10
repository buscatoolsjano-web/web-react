import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  comprasDelProveedor,
  formasDePagoUsadas,
  historialDeProveedor,
  listarProveedores,
  obtenerProveedor,
} from '../services/proveedores'
import type {
  ComprasDelProveedor,
  EventoDeProveedor,
  FiltrosProveedores,
  PaginaDeProveedores,
  ProveedorDetalle,
} from '../types'

/**
 * `companyId` es lo primero de cada clave de caché, igual que en Ventas, en
 * Clientes y en el Catálogo. Dos empresas nunca comparten entrada, y
 * `placeholderData` sólo conserva la página anterior si es de la MISMA
 * empresa: si no, las filas de una quedaban en pantalla bajo el encabezado de
 * la otra.
 */
export function useProveedores(filtros: FiltrosProveedores) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<PaginaDeProveedores>({
    queryKey: ['compras', companyId, 'proveedores', filtros],
    queryFn: () => listarProveedores(companyId!, filtros),
    enabled: companyId !== null,
    placeholderData: (previa, consultaPrevia) => {
      const empresaPrevia = consultaPrevia?.queryKey[1]
      return empresaPrevia === companyId ? previa : undefined
    },
    staleTime: 30_000,
  })
}

export function useProveedor(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<ProveedorDetalle | null>({
    queryKey: ['compras', companyId, 'proveedor', id],
    queryFn: () => obtenerProveedor(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

export function useComprasDelProveedor(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<ComprasDelProveedor>({
    queryKey: ['compras', companyId, 'documentos-proveedor', id],
    queryFn: () => comprasDelProveedor(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

export function useHistorialDeProveedor(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<EventoDeProveedor[]>({
    queryKey: ['compras', companyId, 'historial-proveedor', id],
    queryFn: () => historialDeProveedor(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

/** Las formas de pago que ya existen. Sugerencias, no una lista cerrada. */
export function useFormasDePago() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<string[]>({
    queryKey: ['compras', companyId, 'formas-de-pago'],
    queryFn: () => formasDePagoUsadas(companyId!),
    enabled: companyId !== null,
    staleTime: 5 * 60_000,
  })
}
