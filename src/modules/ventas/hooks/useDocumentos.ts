import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { listarClientes } from '../services/clientes'
import { listarDocumentos, monedasUsadas, obtenerDocumento } from '../services/documentos'
import { documentosRelacionados, evidenciaDeEntrega } from '../services/relacionados'
import { disponibilidadDeProductos } from '../services/stock'
import { calcularPendientes, type ResultadoPendientes } from '../lib/pendientes'
import type {
  DocumentoDetalle,
  FiltrosVentas,
  PaginaDeDocumentos,
  Relacionados,
  TipoDocumento,
} from '../types'

/**
 * `companyId` es lo primero de cada clave de caché — la misma regla que el
 * Catálogo. Dos empresas nunca comparten entrada, y `placeholderData` sólo
 * mantiene la página anterior si es de la MISMA empresa: si no, las filas de
 * una quedaban en pantalla bajo el cartel de la otra.
 */
export function useDocumentos(tipo: TipoDocumento, filtros: FiltrosVentas) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<PaginaDeDocumentos>({
    queryKey: ['ventas', companyId, tipo, 'listado', filtros],
    queryFn: () => listarDocumentos(tipo, companyId!, filtros),
    enabled: companyId !== null,
    placeholderData: (previa, consultaPrevia) => {
      const empresaPrevia = consultaPrevia?.queryKey[1]
      return empresaPrevia === companyId ? previa : undefined
    },
    staleTime: 30_000,
  })
}

export function useDocumento(tipo: TipoDocumento, id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<DocumentoDetalle | null>({
    queryKey: ['ventas', companyId, tipo, 'detalle', id],
    queryFn: () => obtenerDocumento(tipo, companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

export function useRelacionados(tipo: TipoDocumento, id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<Relacionados>({
    queryKey: ['ventas', companyId, tipo, 'relacionados', id],
    queryFn: () => documentosRelacionados(tipo, companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

export function useClientes() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery({
    queryKey: ['ventas', companyId, 'clientes'],
    queryFn: () => listarClientes(companyId!),
    enabled: companyId !== null,
    staleTime: 5 * 60_000,
  })
}

export function useMonedas(tipo: TipoDocumento) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery({
    queryKey: ['ventas', companyId, tipo, 'monedas'],
    queryFn: () => monedasUsadas(tipo, companyId!),
    enabled: companyId !== null,
    staleTime: 5 * 60_000,
  })
}

/**
 * Disponibilidad de los productos del pedido.
 *
 * Sólo para roles internos: `stock_balances` no es legible por un externo, y
 * eso lo decide RLS, no este hook.
 */
export function useDisponibilidad(productIds: readonly string[]) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const esInterno = activa?.esInterno ?? false
  const ids = [...productIds].sort()

  return useQuery({
    queryKey: ['ventas', companyId, 'stock', ids],
    queryFn: () => disponibilidadDeProductos(companyId!, ids),
    enabled: companyId !== null && esInterno && ids.length > 0,
    staleTime: 30_000,
  })
}

/**
 * Pedido / entregado / pendiente de un pedido.
 *
 * El cálculo en sí es `calcularPendientes`, que es una función pura y está
 * probada aparte. Acá sólo se junta la evidencia.
 */
export function usePendientes(pedido: DocumentoDetalle | null | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const pedidoId = pedido?.tipo === 'pedido' ? pedido.id : undefined

  return useQuery<ResultadoPendientes>({
    queryKey: ['ventas', companyId, 'pendientes', pedidoId],
    queryFn: async () => {
      const evidencia = await evidenciaDeEntrega(companyId!, pedidoId!, pedido!.clienteId)
      return calcularPendientes({
        lineasPedido: pedido!.lineas
          .filter((l) => l.tipoLinea !== 'chapter')
          .map((l) => ({ id: l.id, cantidadPedida: l.cantidad })),
        ...evidencia,
      })
    },
    enabled: companyId !== null && !!pedidoId,
    staleTime: 30_000,
  })
}
