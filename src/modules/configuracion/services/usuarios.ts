import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase/client'
import type { DatosInvitacion, ResultadoInvitacion, UsuarioEmpresa } from '../types'

/**
 * Configuración → Usuarios.
 *
 *   · listar, cambiar rol, suspender/reactivar: RPC con el JWT del admin;
 *   · invitar y reenviar: Edge Function `config-usuarios`, la única pieza con
 *     la clave de servicio, que vive en el servidor.
 *
 * El navegador nunca escribe `company_memberships` directo (la base ya no lo
 * permite) y nunca ve la lista global de cuentas de Auth.
 */

export class ErrorUsuarios extends Error {
  constructor(readonly codigo: string) {
    super(codigo)
    this.name = 'ErrorUsuarios'
  }
}

const CODIGOS_RPC = ['sin_permiso', 'ultimo_admin', 'no_auto_suspension', 'rol_invalido', 'rol_externo', 'estado_invalido'] as const

function deErrorRpc(e: { message: string }): ErrorUsuarios {
  const codigo = CODIGOS_RPC.find((c) => e.message.includes(c))
  if (codigo) return new ErrorUsuarios(codigo)
  if (/failed to fetch|network/i.test(e.message)) return new ErrorUsuarios('sin_red')
  return new ErrorUsuarios('desconocido')
}

export async function listarUsuarios(companyId: string): Promise<UsuarioEmpresa[]> {
  const { data, error } = await supabase.rpc('config_listar_usuarios', { p_company: companyId })
  if (error) throw deErrorRpc(error)
  return (data ?? []).map((u) => ({
    membershipId: u.membership_id,
    userId: u.user_id,
    nombre: u.nombre,
    email: u.email,
    rol: u.rol,
    estado: u.estado === 'suspended' ? 'suspended' : 'active',
    cliente: u.cliente,
    alta: u.alta,
    invitadoEl: u.invitado_el,
    emailConfirmado: u.email_confirmado,
    ultimoIngreso: u.ultimo_ingreso,
    bloqueada: u.bloqueada,
    esPropia: u.es_propia,
  }))
}

export async function cambiarRol(membershipId: string, rol: string): Promise<void> {
  const { error } = await supabase.rpc('config_cambiar_rol', { p_membership: membershipId, p_rol: rol })
  if (error) throw deErrorRpc(error)
}

export async function cambiarEstado(membershipId: string, estado: 'active' | 'suspended'): Promise<void> {
  const { error } = await supabase.rpc('config_cambiar_estado', { p_membership: membershipId, p_estado: estado })
  if (error) throw deErrorRpc(error)
}

interface RespuestaFuncion {
  resultado?: ResultadoInvitacion['resultado']
  membership_id?: string
  email_enviado?: boolean
  error_envio?: string
  error?: string
}

async function llamarFuncion(cuerpo: Record<string, unknown>): Promise<ResultadoInvitacion> {
  const respuesta = await supabase.functions.invoke<RespuestaFuncion>('config-usuarios', { body: cuerpo })
  const data: RespuestaFuncion | null = respuesta.data
  const error: unknown = respuesta.error
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const json = (await (error.context as Response).json().catch(() => null)) as RespuestaFuncion | null
      throw new ErrorUsuarios(json?.error ?? ((error.context as Response).status === 401 ? 'sesion_invalida' : 'desconocido'))
    }
    if (error instanceof FunctionsFetchError) throw new ErrorUsuarios('sin_red')
    throw new ErrorUsuarios('desconocido')
  }
  if (!data?.resultado || !data.membership_id) throw new ErrorUsuarios('desconocido')
  return {
    resultado: data.resultado,
    membershipId: data.membership_id,
    emailEnviado: data.email_enviado === true,
    errorEnvio: data.error_envio ?? null,
  }
}

export function invitarUsuario(d: DatosInvitacion): Promise<ResultadoInvitacion> {
  return llamarFuncion({ accion: 'invitar', company_id: d.companyId, email: d.email, nombre: d.nombre, rol: d.rol })
}

export function reenviarInvitacion(membershipId: string): Promise<ResultadoInvitacion> {
  return llamarFuncion({ accion: 'reenviar', membership_id: membershipId })
}
