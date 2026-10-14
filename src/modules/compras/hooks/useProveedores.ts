import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { crearFormaDePago, ErrorMaestro, listarFormasDePago } from '@/modules/configuracion/services/maestros'
import { mensajeErrorMaestro } from '@/modules/configuracion/lib/maestros'
import {
  comprasDelProveedor,

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

/**
 * Las formas de pago de COMPRAS (Fase 68).
 *
 * Antes esto devolvía los textos distintos que ya estaban escritos en los
 * proveedores, para sugerirlos en un `datalist`. Era una lista abierta a
 * propósito —«las 13 condiciones del legacy mezclan incoterms, medios de pago
 * y plazos»— y el resultado fue el previsible: «TRANSFERENCIA BANCARIA» en 41
 * proveedores y «Transferencia bancaria» en uno, más un «ExWorks 30 dais FF».
 *
 * Ahora es un catálogo, igual que el de ventas pero en su propio ámbito: los
 * medios de pago e incoterms de proveedores no tienen nada que hacer en el
 * desplegable de una cotización.
 */
export function useFormasDePago() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery({
    queryKey: ['compras', companyId, 'formas-de-pago'],
    queryFn: () => listarFormasDePago(companyId!, 'purchases'),
    enabled: companyId !== null,
    staleTime: 10 * 60_000,
  })
}

/** Guardar una forma de pago nueva sin salir del formulario. */
export function useAgregarFormaDePago() {
  const { activa } = useEmpresa()
  const cliente = useQueryClient()
  const companyId = activa?.companyId ?? null

  return useCallback(
    async (nombre: string): Promise<string> => {
      if (companyId === null) throw new Error('No hay una empresa activa.')
      try {
        // El nombre que devuelve la base es el NORMALIZADO: si se seleccionara
        // el tipeado, la opción recién creada aparecería como «fuera de la
        // lista» en su propio formulario.
        const creada = await crearFormaDePago(companyId, nombre, 'purchases')
        await cliente.invalidateQueries({ queryKey: ['compras', companyId, 'formas-de-pago'] })
        return creada.nombre
      } catch (e) {
        // El servicio tira el CÓDIGO; mostrarlo crudo sería mostrar
        // «nombre_duplicado». Con `cause` para no perder el original.
        if (e instanceof ErrorMaestro) {
          throw new Error(mensajeErrorMaestro(e.codigo), { cause: e })
        }
        throw e
      }
    },
    [companyId, cliente],
  )
}
