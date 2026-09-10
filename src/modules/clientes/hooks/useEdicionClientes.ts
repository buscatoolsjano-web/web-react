import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  actualizarCliente,
  actualizarContacto,
  actualizarDireccion,
  borrarContacto,
  borrarDireccion,
  crearCliente,
  crearContacto,
  crearDireccion,
  darDeBajaCliente,
  reactivarCliente,
  resolverRevision,
} from '../services/edicion'
import type { DatosCliente, DatosContacto, DatosDireccion } from '../lib/validacion'

/**
 * Las mutaciones del módulo.
 *
 * Cada una invalida lo que dejó viejo y nada más: guardar un contacto no tiene
 * por qué volver a pedir el listado de 1.010 clientes.
 */

/** Todo lo de esta empresa. Se usa cuando cambió la ficha en sí. */
function clavesDelCliente(companyId: string | null, clienteId?: string) {
  return {
    listado: ['clientes', companyId, 'listado'] as const,
    detalle: ['clientes', companyId, 'detalle', clienteId] as const,
    contactos: ['clientes', companyId, 'contactos', clienteId] as const,
    relacionados: ['clientes', companyId, 'relacionados', clienteId] as const,
    rubros: ['clientes', companyId, 'rubros'] as const,
  }
}

export function useCrearCliente() {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  return useMutation({
    mutationFn: (datos: DatosCliente) => crearCliente(companyId!, datos),
    onSuccess: () => {
      const k = clavesDelCliente(companyId)
      void qc.invalidateQueries({ queryKey: k.listado })
      void qc.invalidateQueries({ queryKey: k.rubros })
      // El buscador de clientes de Ventas también quedó viejo: el cliente
      // nuevo tiene que poder elegirse sin recargar la página.
      void qc.invalidateQueries({ queryKey: ['ventas', companyId, 'clientes'] })
      void qc.invalidateQueries({ queryKey: ['ventas', companyId, 'buscar-cliente'] })
    },
  })
}

export function useActualizarCliente(clienteId: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  return useMutation({
    mutationFn: (datos: DatosCliente) => actualizarCliente(companyId!, clienteId, datos),
    onSuccess: () => {
      const k = clavesDelCliente(companyId, clienteId)
      void qc.invalidateQueries({ queryKey: k.detalle })
      void qc.invalidateQueries({ queryKey: k.listado })
      void qc.invalidateQueries({ queryKey: k.rubros })
      // Renombrar al cliente cambia lo que muestran los documentos de Ventas,
      // que leen su nombre por FK. Los documentos no se tocan; lo que hay que
      // rehacer es la caché.
      void qc.invalidateQueries({ queryKey: ['ventas', companyId] })
    },
  })
}

export function useBajaCliente(clienteId: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  const invalidar = () => {
    const k = clavesDelCliente(companyId, clienteId)
    void qc.invalidateQueries({ queryKey: k.detalle })
    void qc.invalidateQueries({ queryKey: k.listado })
    void qc.invalidateQueries({ queryKey: ['ventas', companyId] })
  }

  return {
    dar: useMutation({
      mutationFn: () => darDeBajaCliente(companyId!, clienteId),
      onSuccess: invalidar,
    }),
    reactivar: useMutation({
      mutationFn: () => reactivarCliente(companyId!, clienteId),
      onSuccess: invalidar,
    }),
  }
}

export function useResolverRevision(clienteId: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  return useMutation({
    mutationFn: (motivos?: readonly string[]) => resolverRevision(clienteId, motivos),
    onSuccess: () => {
      const k = clavesDelCliente(companyId, clienteId)
      void qc.invalidateQueries({ queryKey: k.detalle })
      void qc.invalidateQueries({ queryKey: k.listado })
    },
  })
}

export function useContactosEdicion(clienteId: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null
  const invalidar = () =>
    void qc.invalidateQueries({ queryKey: clavesDelCliente(companyId, clienteId).contactos })

  return {
    crear: useMutation({
      mutationFn: (datos: DatosContacto) => crearContacto(companyId!, clienteId, datos),
      onSuccess: invalidar,
    }),
    actualizar: useMutation({
      mutationFn: (v: { id: string; datos: DatosContacto }) =>
        actualizarContacto(companyId!, clienteId, v.id, v.datos),
      onSuccess: invalidar,
    }),
    borrar: useMutation({
      mutationFn: (id: string) => borrarContacto(companyId!, id),
      onSuccess: invalidar,
    }),
  }
}

export function useDireccionesEdicion(clienteId: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null
  const invalidar = () =>
    void qc.invalidateQueries({ queryKey: clavesDelCliente(companyId, clienteId).relacionados })

  return {
    crear: useMutation({
      mutationFn: (datos: DatosDireccion) => crearDireccion(companyId!, clienteId, datos),
      onSuccess: invalidar,
    }),
    actualizar: useMutation({
      mutationFn: (v: { id: string; datos: DatosDireccion }) =>
        actualizarDireccion(companyId!, clienteId, v.id, v.datos),
      onSuccess: invalidar,
    }),
    borrar: useMutation({
      mutationFn: (id: string) => borrarDireccion(companyId!, id),
      onSuccess: invalidar,
    }),
  }
}
