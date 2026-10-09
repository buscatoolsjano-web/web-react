import { supabase } from '@/services/supabase/client'
import type { Capacidad, Concesion } from '../lib/capacidades'

/**
 * Los permisos por rol (Fase 58 · E2).
 *
 * El catálogo y las concesiones se leen con `select` directo: lo que protege
 * las concesiones es la política RLS `role_capabilities_select`, que sólo deja
 * verlas a un admin activo de esa empresa. Un empleado que pida la tabla recibe
 * cero filas, no un error.
 *
 * Guardar NO es un `update`: la tabla no tiene políticas de escritura a
 * propósito. Va por `config_permisos_rol_guardar`, que valida que quien llama
 * sea admin, que el rol se pueda configurar y que los permisos existan, y deja
 * el antes/después en `role_capabilities_audit`.
 */

export class ErrorPermisos extends Error {
  constructor(readonly codigo: string) {
    super(codigo)
    this.name = 'ErrorPermisos'
  }
}

const CODIGOS = ['sin_permiso', 'rol_no_configurable', 'permiso_desconocido'] as const

function deError(e: { message: string }): ErrorPermisos {
  const codigo = CODIGOS.find((c) => e.message.includes(c))
  if (codigo) return new ErrorPermisos(codigo)
  if (/failed to fetch|network/i.test(e.message)) return new ErrorPermisos('sin_red')
  return new ErrorPermisos('desconocido')
}

/**
 * Qué permisos existen. Es una tabla estática —la cambia una migración— así que
 * el hook la cachea con un `staleTime` largo.
 */
export async function listarCapacidades(): Promise<Capacidad[]> {
  const { data, error } = await supabase
    .from('capability_catalog')
    .select('key, label, description, position')
    .order('position')

  if (error) throw deError(error)
  return (data ?? []).map((c) => ({
    clave: c.key,
    etiqueta: c.label,
    descripcion: c.description,
    posicion: c.position,
  }))
}

/** Qué rol tiene cada permiso en esta empresa. El admin no figura: tiene todo. */
export async function listarConcesiones(companyId: string): Promise<Concesion[]> {
  const { data, error } = await supabase
    .from('role_capabilities')
    .select('role, capability')
    .eq('company_id', companyId)

  if (error) throw deError(error)
  return (data ?? []).map((c) => ({ rol: c.role, capacidad: c.capability }))
}

/**
 * Reemplaza los permisos de un rol por la lista que se manda.
 *
 * Reemplaza y no suma ni resta de a uno: la pantalla manda el estado final de
 * las casillas, y así dos administradores editando a la vez no terminan con una
 * mezcla de los dos cambios que ninguno pidió.
 */
export async function guardarPermisosDeRol(
  companyId: string,
  rol: string,
  capacidades: readonly string[],
): Promise<void> {
  const { error } = await supabase.rpc('config_permisos_rol_guardar', {
    p_company: companyId,
    p_role: rol,
    p_caps: [...capacidades],
  })
  if (error) throw deError(error)
}
