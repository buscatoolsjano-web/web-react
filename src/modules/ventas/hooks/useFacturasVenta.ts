import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { crearFacturaDesdePedido, listarFacturas, obtenerFactura } from '../services/facturas'

/**
 * Facturas de venta (Fase 29 · E7).
 *
 * `useFacturas` ya existe en Compras y es OTRA cosa —las facturas de
 * proveedor—, por eso el nombre largo: dos hooks con el mismo nombre en un
 * módulo que habla de «facturas» todo el tiempo terminaría importando el que
 * no es.
 */
export function useFacturasVenta() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery({
    queryKey: ['ventas', companyId, 'facturas'],
    queryFn: () => listarFacturas(companyId!),
    enabled: companyId !== null,
    staleTime: 30_000,
  })
}

export function useFacturaVenta(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery({
    queryKey: ['ventas', companyId, 'factura', id],
    queryFn: () => obtenerFactura(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

/**
 * Emitir la factura de un pedido.
 *
 * Invalida TODO el árbol de ventas de la empresa y no sólo las facturas: la
 * cadena del pedido y la del remito también cambian —pasan a tener factura—,
 * y si no se refrescan la barra seguiría mostrando un guion sobre algo que ya
 * existe.
 */
export function useCrearFacturaDesdePedido() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ orderId, fecha }: { orderId: string; fecha?: string | null }) =>
      crearFacturaDesdePedido(orderId, fecha ?? null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ventas', companyId] })
    },
  })
}
