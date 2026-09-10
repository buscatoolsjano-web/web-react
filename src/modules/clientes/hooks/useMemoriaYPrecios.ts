import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/useAuth'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  actualizarAlias,
  borrarAlias,
  buscarProductos,
  confirmarAlias,
  crearAlias,
  descartarAlias,
  listarAlias,
} from '../services/memoria'
import type { DatosAlias } from '../lib/alias'
import { preciosHistoricos, ultimosPrecios } from '../services/precios'
import type { AliasDeProducto, PagRecordDePrecios, UltimoPrecio } from '../types'

/**
 * Memoria de productos y precios.
 *
 * `companyId` primero en cada clave, igual que en el resto del proyecto. Las
 * consultas de precios llevan además el id del cliente: son dos funciones SQL
 * que ya filtran del lado del servidor, así que la caché no tiene por qué
 * guardar nada más ancho que lo que se pidió.
 */

export function useAlias(clienteId: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<AliasDeProducto[]>({
    queryKey: ['clientes', companyId, 'alias', clienteId],
    queryFn: () => listarAlias(companyId!, clienteId!),
    enabled: companyId !== null && !!clienteId,
    staleTime: 30_000,
  })
}

export function useAliasEdicion(clienteId: string) {
  const { activa } = useEmpresa()
  const { user } = useAuth()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null
  const invalidar = () =>
    void qc.invalidateQueries({ queryKey: ['clientes', companyId, 'alias', clienteId] })

  return {
    crear: useMutation({
      mutationFn: (datos: DatosAlias) => crearAlias(companyId!, clienteId, datos),
      onSuccess: invalidar,
    }),
    actualizar: useMutation({
      mutationFn: (v: { id: string; datos: DatosAlias }) =>
        actualizarAlias(companyId!, v.id, v.datos),
      onSuccess: invalidar,
    }),
    confirmar: useMutation({
      mutationFn: (id: string) => confirmarAlias(companyId!, id, user!.id),
      onSuccess: invalidar,
    }),
    descartar: useMutation({
      mutationFn: (id: string) => descartarAlias(companyId!, id),
      onSuccess: invalidar,
    }),
    borrar: useMutation({
      mutationFn: (id: string) => borrarAlias(companyId!, id),
      onSuccess: invalidar,
    }),
  }
}

export function useBuscarProductos(texto: string, activo: boolean) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery({
    queryKey: ['clientes', companyId, 'buscar-producto', texto],
    queryFn: () => buscarProductos(companyId!, texto),
    enabled: companyId !== null && activo && texto.trim().length >= 2,
    staleTime: 30_000,
  })
}

export function useUltimosPrecios(clienteId: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<UltimoPrecio[]>({
    queryKey: ['clientes', companyId, 'ultimos-precios', clienteId],
    queryFn: () => ultimosPrecios(clienteId!),
    enabled: companyId !== null && !!clienteId,
    staleTime: 60_000,
  })
}

export function usePreciosHistoricos(
  clienteId: string | undefined,
  pagina: number,
  porPagina: number,
  productId: string | null,
) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<PagRecordDePrecios>({
    queryKey: ['clientes', companyId, 'precios', clienteId, productId, pagina, porPagina],
    queryFn: () => preciosHistoricos(clienteId!, { productId, pagina, porPagina }),
    enabled: companyId !== null && !!clienteId,
    placeholderData: (previa, consultaPrevia) => {
      const clientePrevio = consultaPrevia?.queryKey[3]
      return clientePrevio === clienteId ? previa : undefined
    },
    staleTime: 60_000,
  })
}
