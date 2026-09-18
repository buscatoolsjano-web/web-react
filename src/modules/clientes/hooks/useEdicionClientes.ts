import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  guardarCliente,
  guardarContacto,
  guardarDireccion,
  borrarContacto,
  borrarDireccion,
  crearCliente,
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

/**
 * El guardado de la ficha (Fase 17 · E1).
 *
 * Una sola RPC con el testigo de concurrencia. Lo que se invalida es lo que
 * quedó viejo: la ficha, el listado, los rubros y la caché de Ventas —que
 * muestra el nombre del cliente en cada documento por FK—.
 */
export function useActualizarCliente(clienteId: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  return useMutation({
    mutationFn: ({ esperado, datos }: { esperado: string; datos: DatosCliente }) =>
      guardarCliente(clienteId, esperado, datos),
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

/**
 * Contactos (Fase 17 · E3).
 *
 * Una sola mutación `guardar` para el alta y la edición, porque del otro lado
 * es una sola RPC: `id` nulo es un alta. `esperado` es el testigo de
 * concurrencia que se leyó al abrir el formulario.
 *
 * Guardar un contacto también invalida Ventas: el contacto principal es el que
 * se sugiere al armar un documento nuevo, y desactivar uno lo saca del
 * desplegable.
 */
export function useContactosEdicion(clienteId: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null
  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: clavesDelCliente(companyId, clienteId).contactos })
    void qc.invalidateQueries({ queryKey: ['ventas', companyId, 'contactos', clienteId] })
    void qc.invalidateQueries({ queryKey: ['ventas', companyId, 'defaults', clienteId] })
  }

  return {
    guardar: useMutation({
      mutationFn: (v: { id: string | null; esperado: string | null; datos: DatosContacto }) =>
        guardarContacto(clienteId, v.id, v.esperado, v.datos),
      onSuccess: invalidar,
    }),
    borrar: useMutation({
      mutationFn: (id: string) => borrarContacto(id),
      onSuccess: invalidar,
    }),
  }
}

/** Direcciones (Fase 17 · E3). Lo mismo, con la principal resuelta por tipo. */
export function useDireccionesEdicion(clienteId: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null
  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: clavesDelCliente(companyId, clienteId).relacionados })
    // La dirección de entrega se elige en el pedido: si acá se agrega, se
    // desactiva o se cambia la principal, ese desplegable quedó viejo.
    void qc.invalidateQueries({ queryKey: ['ventas', companyId, 'direcciones', clienteId] })
    void qc.invalidateQueries({ queryKey: ['ventas', companyId, 'defaults', clienteId] })
  }

  return {
    guardar: useMutation({
      mutationFn: (v: { id: string | null; esperado: string | null; datos: DatosDireccion }) =>
        guardarDireccion(clienteId, v.id, v.esperado, v.datos),
      onSuccess: invalidar,
    }),
    borrar: useMutation({
      mutationFn: (id: string) => borrarDireccion(id),
      onSuccess: invalidar,
    }),
  }
}
