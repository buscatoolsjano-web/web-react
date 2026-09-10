import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  actualizarRecepcion,
  borrarRecepcion,
  confirmarRecepcion,
  crearRecepcion,
  depositosActivos,
  guardarLineasRecepcion,
  lineasDeRecepcion,
  listarRecepciones,
  obtenerRecepcion,
  pendienteDePedido,
  type CantidadARecibir,
  type DatosRecepcion,
} from '../services/recepciones'
import type {
  Deposito,
  FiltrosRecepciones,
  LineaRecepcion,
  PaginaDeRecepciones,
  PendienteDeLinea,
  RecepcionDetalle,
} from '../types'

export function useRecepciones(filtros: FiltrosRecepciones) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<PaginaDeRecepciones>({
    queryKey: ['compras', companyId, 'recepciones', filtros],
    queryFn: () => listarRecepciones(companyId!, filtros),
    enabled: companyId !== null,
    placeholderData: (previa, consultaPrevia) => {
      const empresaPrevia = consultaPrevia?.queryKey[1]
      return empresaPrevia === companyId ? previa : undefined
    },
    staleTime: 30_000,
  })
}

export function useRecepcion(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<RecepcionDetalle | null>({
    queryKey: ['compras', companyId, 'recepcion', id],
    queryFn: () => obtenerRecepcion(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

export function useLineasDeRecepcion(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<LineaRecepcion[]>({
    queryKey: ['compras', companyId, 'lineas-recepcion', id],
    queryFn: () => lineasDeRecepcion(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

export function useDepositos() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<Deposito[]>({
    queryKey: ['compras', companyId, 'depositos'],
    queryFn: () => depositosActivos(companyId!),
    enabled: companyId !== null,
    staleTime: 5 * 60_000,
  })
}

/**
 * Lo pendiente de un pedido.
 *
 * `staleTime: 0` a propósito: es la cuenta que decide cuánto se puede recibir
 * y no puede servirse de una caché vieja. Al confirmar cualquier recepción se
 * invalida.
 */
export function usePendienteDePedido(
  pedidoId: string | undefined,
  depositoId: string | null,
  excluirRecepcionId: string | null = null,
) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<PendienteDeLinea[]>({
    queryKey: ['compras', companyId, 'pendiente', pedidoId, depositoId, excluirRecepcionId],
    queryFn: () => pendienteDePedido(companyId!, pedidoId!, depositoId, excluirRecepcionId),
    enabled: companyId !== null && !!pedidoId,
    staleTime: 0,
  })
}

// ── Mutaciones ─────────────────────────────────────────────────────────────

/**
 * Confirmar una recepción cambia media aplicación: el stock, el saldo del
 * depósito, el `receipt_status` del pedido y la auditoría. Se invalida todo
 * eso, incluido el catálogo, que muestra disponibilidad.
 */
function invalidarTodo(qc: ReturnType<typeof useQueryClient>, companyId: string | null) {
  for (const clave of [
    ['compras', companyId, 'recepciones'],
    ['compras', companyId, 'pendiente'],
    ['compras', companyId, 'pedidos'],
    ['compras', companyId, 'pedido'],
    ['compras', companyId, 'relacionados-pedido'],
    ['compras', companyId, 'documentos-proveedor'],
    ['compras', companyId, 'historial-proveedor'],
    ['catalogo', companyId],
    ['ventas', companyId, 'stock'],
  ]) {
    void qc.invalidateQueries({ queryKey: clave })
  }
}

export function useCrearRecepcion() {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  return useMutation({
    mutationFn: ({ datos, lineas }: { datos: DatosRecepcion; lineas: CantidadARecibir[] }) =>
      crearRecepcion(companyId!, datos, lineas),
    onSuccess: () => invalidarTodo(qc, companyId),
  })
}

export function useEditarRecepcion(id: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ['compras', companyId, 'recepcion', id] })
    void qc.invalidateQueries({ queryKey: ['compras', companyId, 'lineas-recepcion', id] })
    invalidarTodo(qc, companyId)
  }

  return {
    cabecera: useMutation({
      mutationFn: (d: Parameters<typeof actualizarRecepcion>[2]) =>
        actualizarRecepcion(companyId!, id, d),
      onSuccess: invalidar,
    }),
    lineas: useMutation({
      mutationFn: (lineas: CantidadARecibir[]) =>
        guardarLineasRecepcion(companyId!, id, lineas),
      onSuccess: invalidar,
    }),
    confirmar: useMutation({
      mutationFn: () => confirmarRecepcion(id),
      onSuccess: invalidar,
    }),
    borrar: useMutation({
      mutationFn: () => borrarRecepcion(companyId!, id),
      onSuccess: invalidar,
    }),
  }
}
