/**
 * Quién usa el chat interno.
 *
 * ÚNICO lugar del frontend que lo sabe: lo usan el menú y la página. NO es el
 * control de acceso —ése es la RLS y las RPC, que exigen `security definer` y
 * pertenencia a la empresa— sino no ofrecerle a nadie una pantalla que va a
 * volver vacía.
 *
 * Es el conjunto «de adentro»: el mismo de
 * `app.current_internal_company_ids()`. Un cliente o un distribuidor no
 * aparecen en la lista ni pueden abrir un chat, y la base tampoco los deja.
 */
export const ROLES_CHAT = ['admin', 'employee', 'salesperson', 'technician'] as const

export function puedeUsarChat(rol: string | null | undefined): boolean {
  return !!rol && (ROLES_CHAT as readonly string[]).includes(rol)
}
