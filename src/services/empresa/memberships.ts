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
 * EL FILTRO POR `user_id` ES OBLIGATORIO. La política de RLS es
 *
 *     (user_id = auth.uid()) OR app.is_admin(company_id)
 *
 * o sea que un admin ve TODAS las membresías de su empresa — algo correcto
 * y necesario para poder administrar usuarios, pero que no es lo que este
 * servicio quiere. Sin el filtro, a Jano (admin en Buscatools) el selector
 * de empresa le mostraba las 8 membresías de todo el sistema, y la
 * membresía activa podía terminar siendo la de otra persona: si la primera
 * fila hubiera sido la del `customer`, la UI lo habría tratado como
 * cliente externo y le habría ocultado el stock.
 *
 * No es un agujero de seguridad —RLS sigue gobernando qué datos se leen—
 * pero sí un error de identidad en la interfaz.
 *
 * Jano tiene dos membresías: admin en Buscatools y salesperson en
 * Torquetools. El rol pertenece a la membresía, no a la persona.
 */
export async function listarMembresias(userId: string): Promise<Membresia[]> {
  const { data, error } = await supabase
    .from('company_memberships')
    .select('company_id, role, customer_id, companies ( name, slug )')
    .eq('user_id', userId)
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
