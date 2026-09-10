import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  contactosDeCliente,
  documentosDeCliente,
  listarClientes,
  obtenerCliente,
  relacionadosDeCliente,
  rubrosUsados,
} from '../services/clientes'
import type {
  ClienteDetalle,
  ContactoCliente,
  DocumentoDeCliente,
  FiltrosClientes,
  PaginaDeClientes,
  RelacionadosCliente,
} from '../types'

/**
 * `companyId` es lo primero de cada clave de caché, igual que en Ventas y en
 * el Catálogo. Dos empresas nunca comparten entrada, y `placeholderData` sólo
 * conserva la página anterior si es de la MISMA empresa: si no, las filas de
 * una quedaban en pantalla bajo el encabezado de la otra.
 */
export function useClientes(filtros: FiltrosClientes) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<PaginaDeClientes>({
    queryKey: ['clientes', companyId, 'listado', filtros],
    queryFn: () => listarClientes(companyId!, filtros),
    enabled: companyId !== null,
    placeholderData: (previa, consultaPrevia) => {
      const empresaPrevia = consultaPrevia?.queryKey[1]
      return empresaPrevia === companyId ? previa : undefined
    },
    staleTime: 30_000,
  })
}

export function useCliente(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<ClienteDetalle | null>({
    queryKey: ['clientes', companyId, 'detalle', id],
    queryFn: () => obtenerCliente(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

export function useContactos(clienteId: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<ContactoCliente[]>({
    queryKey: ['clientes', companyId, 'contactos', clienteId],
    queryFn: () => contactosDeCliente(companyId!, clienteId!),
    enabled: companyId !== null && !!clienteId,
    staleTime: 30_000,
  })
}

export function useHistorial(clienteId: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<DocumentoDeCliente[]>({
    queryKey: ['clientes', companyId, 'historial', clienteId],
    queryFn: () => documentosDeCliente(companyId!, clienteId!),
    enabled: companyId !== null && !!clienteId,
    staleTime: 30_000,
  })
}

export function useRelacionados(clienteId: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<RelacionadosCliente>({
    queryKey: ['clientes', companyId, 'relacionados', clienteId],
    queryFn: () => relacionadosDeCliente(companyId!, clienteId!),
    enabled: companyId !== null && !!clienteId,
    staleTime: 30_000,
  })
}

export function useRubros() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<string[]>({
    queryKey: ['clientes', companyId, 'rubros'],
    queryFn: () => rubrosUsados(companyId!),
    enabled: companyId !== null,
    staleTime: 5 * 60_000,
  })
}
