import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { listarClientes } from '../services/clientes'
import { listarEventos, type EntidadAuditable } from '../services/auditoria'
import {
  contactosDeCliente,
  direccionesDeEntrega,
  tarifasDeEmpresa,
  vendedoresDeEmpresa,
} from '../services/opciones'
import { facetasDeDocumentos, listarDocumentos, obtenerDocumento } from '../services/documentos'
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

/**
 * Las monedas y las series EN USO, para los dos desplegables.
 *
 * Una sola consulta para los dos: antes `useMonedas` recorría la tabla para
 * quedarse con tres monedas, y la serie habría sido un recorrido idéntico.
 */
export function useFacetas(tipo: TipoDocumento) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery({
    queryKey: ['ventas', companyId, tipo, 'facetas'],
    queryFn: () => facetasDeDocumentos(tipo, companyId!),
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

/** `TipoDocumento` → la entidad con la que `sales_audit` guarda sus eventos. */
const ENTIDAD_DE: Record<TipoDocumento, EntidadAuditable> = {
  cotizacion: 'sales_quote',
  pedido: 'sales_order',
  entrega: 'delivery',
}

/**
 * Los eventos del documento, para la pestaña Trazabilidad.
 *
 * Se consulta sólo cuando esa pestaña está abierta —el panel se monta recién
 * ahí— y sólo para quien escribe: la policy `audit_select` limita `sales_audit`
 * a las empresas donde la persona escribe, así que pedirlos desde otro rol
 * sería un viaje para recibir cero filas.
 */
export function useTrazabilidad(tipo: TipoDocumento, id: string | undefined, habilitado: boolean) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery({
    queryKey: ['ventas', companyId, tipo, 'trazabilidad', id],
    queryFn: () => listarEventos(companyId!, ENTIDAD_DE[tipo], id!),
    enabled: companyId !== null && !!id && habilitado,
    staleTime: 30_000,
  })
}

// ── Opciones del editor (Fase 15 · E2) ─────────────────────────────────────

/**
 * Los contactos del cliente elegido.
 *
 * Se piden cuando hay cliente y nada más. Sin `customerId` no se consulta:
 * traer los 87 contactos de la empresa para filtrar tres en el navegador es
 * exactamente el patrón que dejó al sistema anterior sin ancho de banda.
 */
export function useContactos(customerId: string | null) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery({
    queryKey: ['ventas', companyId, 'contactos', customerId],
    queryFn: () => contactosDeCliente(companyId!, customerId!),
    enabled: companyId !== null && !!customerId,
    staleTime: 5 * 60_000,
  })
}

/**
 * Los domicilios de entrega del cliente elegido (Fase 17 · E3).
 *
 * Igual que los contactos: sólo con cliente, y una consulta acotada. La clave
 * de caché es la que invalida la ficha del cliente cuando alguien agrega,
 * desactiva o cambia la principal.
 */
export function useDireccionesEntrega(customerId: string | null) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery({
    queryKey: ['ventas', companyId, 'direcciones', customerId],
    queryFn: () => direccionesDeEntrega(companyId!, customerId!),
    enabled: companyId !== null && !!customerId,
    staleTime: 5 * 60_000,
  })
}

/** Las listas de precios de la empresa. Son pocas y cambian poco. */
export function useTarifas(habilitado = true) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery({
    queryKey: ['ventas', companyId, 'tarifas'],
    queryFn: () => tarifasDeEmpresa(companyId!),
    enabled: companyId !== null && habilitado,
    staleTime: 10 * 60_000,
  })
}

/** A quién se le puede asignar la venta. */
export function useVendedores(habilitado = true) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery({
    queryKey: ['ventas', companyId, 'vendedores'],
    queryFn: () => vendedoresDeEmpresa(companyId!),
    enabled: companyId !== null && habilitado,
    staleTime: 10 * 60_000,
  })
}
