import { supabase } from '@/services/supabase/client'

/** Roles conocidos. Los internos ven costos y stock; los externos no. */
export const ROLES_INTERNOS = ['admin', 'employee', 'salesperson', 'technician'] as const
export const ROLES_EXTERNOS = ['customer', 'distributor'] as const

export type RolInterno = (typeof ROLES_INTERNOS)[number]
export type RolExterno = (typeof ROLES_EXTERNOS)[number]
export type Rol = RolInterno | RolExterno

export function esRolInterno(rol: string): boolean {
  return (ROLES_INTERNOS as readonly string[]).includes(rol)
}

export interface Membresia {
  companyId: string
  companyName: string
  companySlug: string
  rol: string
  esInterno: boolean
  /** Sólo para roles externos: el cliente al que representa. */
  customerId: string | null
}

/**
 * Membresías del usuario autenticado.
 *
 * No hace falta filtrar por user_id: RLS ya devuelve únicamente las del
 * usuario del JWT. Igual se pasa `status = 'active'`, que es regla de
 * negocio y no de seguridad.
 *
 * Jano tiene dos: admin en Buscatools y salesperson en Torquetools. El rol
 * pertenece a la membresía, no a la persona.
 */
export async function listarMembresias(): Promise<Membresia[]> {
  const { data, error } = await supabase
    .from('company_memberships')
    .select('company_id, role, customer_id, companies ( name, slug )')
    .eq('status', 'active')

  if (error) throw new Error(`No se pudieron leer las empresas: ${error.message}`)

  return (data ?? []).map((m) => ({
    companyId: m.company_id,
    companyName: m.companies?.name ?? '(sin nombre)',
    companySlug: m.companies?.slug ?? '',
    rol: m.role,
    esInterno: esRolInterno(m.role),
    customerId: m.customer_id,
  }))
}
