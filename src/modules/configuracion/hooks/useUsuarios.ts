import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { ErrorUsuarios, cambiarEstado, cambiarRol, invitarUsuario, listarUsuarios, reenviarInvitacion } from '../services/usuarios'
import type { DatosInvitacion, UsuarioEmpresa } from '../types'

export const clavesConfiguracion = {
  usuarios: (companyId: string | null) => ['configuracion', companyId, 'usuarios'] as const,
}

export function useUsuarios() {
  const companyId = useEmpresa().activa?.companyId ?? null
  return useQuery<UsuarioEmpresa[]>({
    queryKey: clavesConfiguracion.usuarios(companyId),
    queryFn: () => listarUsuarios(companyId!),
    enabled: companyId !== null,
    // Sin permiso no se arregla reintentando.
    retry: (intentos, error) => !(error instanceof ErrorUsuarios && error.codigo === 'sin_permiso') && intentos < 1,
  })
}

/** Toda escritura invalida la lista: el estado real lo devuelve la base. */
export function useAccionesUsuarios() {
  const qc = useQueryClient()
  const companyId = useEmpresa().activa?.companyId ?? null
  const refrescar = async () => {
    await qc.invalidateQueries({ queryKey: clavesConfiguracion.usuarios(companyId) })
    // Si el admin cambió su propio rol, el menú y los permisos de la interfaz
    // salen de las membresías del usuario: también se releen.
    await qc.invalidateQueries({ queryKey: ['empresa', 'membresias'] })
  }

  return {
    cambiarRol: useMutation({
      mutationFn: (v: { membershipId: string; rol: string }) => cambiarRol(v.membershipId, v.rol),
      onSettled: refrescar,
    }),
    cambiarEstado: useMutation({
      mutationFn: (v: { membershipId: string; estado: 'active' | 'suspended' }) => cambiarEstado(v.membershipId, v.estado),
      onSettled: refrescar,
    }),
    invitar: useMutation({
      mutationFn: (d: Omit<DatosInvitacion, 'companyId'>) => invitarUsuario({ ...d, companyId: companyId! }),
      onSettled: refrescar,
    }),
    reenviar: useMutation({
      mutationFn: (membershipId: string) => reenviarInvitacion(membershipId),
      onSettled: refrescar,
    }),
  }
}
