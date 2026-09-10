import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  actualizarPedido,
  cancelarPedido,
  confirmarPedido,
  crearPedido,
  duplicarPedido,
  guardarLineas,
  lineasDePedido,
  listarPedidos,
  monedasUsadas,
  obtenerPedido,
  relacionadosDePedido,
} from '../services/pedidos'
import type { DatosPedidoCompra } from '../lib/validacion'
import type {
  FiltrosPedidos,
  LineaPedidoCompra,
  PaginaDePedidos,
  PedidoCompraDetalle,
  RelacionadosPedido,
} from '../types'

/**
 * `companyId` es lo primero de cada clave, igual que en el resto de la app.
 * Dos empresas nunca comparten entrada, y `placeholderData` sólo conserva la
 * página anterior si es de la MISMA empresa.
 */
export function usePedidos(filtros: FiltrosPedidos) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<PaginaDePedidos>({
    queryKey: ['compras', companyId, 'pedidos', filtros],
    queryFn: () => listarPedidos(companyId!, filtros),
    enabled: companyId !== null,
    placeholderData: (previa, consultaPrevia) => {
      const empresaPrevia = consultaPrevia?.queryKey[1]
      return empresaPrevia === companyId ? previa : undefined
    },
    staleTime: 30_000,
  })
}

export function usePedido(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<PedidoCompraDetalle | null>({
    queryKey: ['compras', companyId, 'pedido', id],
    queryFn: () => obtenerPedido(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

export function useLineasDePedido(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<LineaPedidoCompra[]>({
    queryKey: ['compras', companyId, 'lineas-pedido', id],
    queryFn: () => lineasDePedido(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

export function useRelacionadosDePedido(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<RelacionadosPedido>({
    queryKey: ['compras', companyId, 'relacionados-pedido', id],
    queryFn: () => relacionadosDePedido(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

export function useMonedasUsadas() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<string[]>({
    queryKey: ['compras', companyId, 'monedas-pedidos'],
    queryFn: () => monedasUsadas(companyId!),
    enabled: companyId !== null,
    staleTime: 5 * 60_000,
  })
}

// ── Mutaciones ─────────────────────────────────────────────────────────────

/**
 * Cada mutación invalida lo que dejó viejo.
 *
 * El historial del proveedor también: confirmar o cancelar un pedido escribe
 * en `purchases_audit`, y la ficha del proveedor muestra sus eventos.
 */
function claves(companyId: string | null, id?: string) {
  return {
    listado: ['compras', companyId, 'pedidos'] as const,
    detalle: ['compras', companyId, 'pedido', id] as const,
    lineas: ['compras', companyId, 'lineas-pedido', id] as const,
    relacionados: ['compras', companyId, 'relacionados-pedido', id] as const,
    monedas: ['compras', companyId, 'monedas-pedidos'] as const,
    documentosProveedor: ['compras', companyId, 'documentos-proveedor'] as const,
  }
}

export function useCrearPedido() {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  return useMutation({
    mutationFn: ({ datos, lineas }: { datos: DatosPedidoCompra; lineas: LineaPedidoCompra[] }) =>
      crearPedido(companyId!, datos, lineas),
    onSuccess: () => {
      const k = claves(companyId)
      void qc.invalidateQueries({ queryKey: k.listado })
      void qc.invalidateQueries({ queryKey: k.monedas })
      void qc.invalidateQueries({ queryKey: k.documentosProveedor })
    },
  })
}

export function useGuardarPedido(id: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  const invalidar = () => {
    const k = claves(companyId, id)
    void qc.invalidateQueries({ queryKey: k.detalle })
    void qc.invalidateQueries({ queryKey: k.lineas })
    void qc.invalidateQueries({ queryKey: k.listado })
  }

  return {
    cabecera: useMutation({
      mutationFn: ({ datos, puedeIdentidad }: { datos: DatosPedidoCompra; puedeIdentidad: boolean }) =>
        actualizarPedido(companyId!, id, datos, puedeIdentidad),
      onSuccess: invalidar,
    }),
    lineas: useMutation({
      mutationFn: (lineas: LineaPedidoCompra[]) => guardarLineas(companyId!, id, lineas),
      onSuccess: invalidar,
    }),
  }
}

export function useEstadoPedido(id: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  const invalidar = () => {
    const k = claves(companyId, id)
    void qc.invalidateQueries({ queryKey: k.detalle })
    void qc.invalidateQueries({ queryKey: k.lineas })
    void qc.invalidateQueries({ queryKey: k.listado })
    // La ficha del proveedor cuenta sus pedidos y muestra su auditoría.
    void qc.invalidateQueries({ queryKey: ['compras', companyId, 'documentos-proveedor'] })
    void qc.invalidateQueries({ queryKey: ['compras', companyId, 'historial-proveedor'] })
  }

  return {
    confirmar: useMutation({
      mutationFn: () => confirmarPedido(companyId!, id),
      onSuccess: invalidar,
    }),
    cancelar: useMutation({
      mutationFn: () => cancelarPedido(companyId!, id),
      onSuccess: invalidar,
    }),
    duplicar: useMutation({
      mutationFn: () => duplicarPedido(id),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: claves(companyId).listado })
      },
    }),
  }
}
