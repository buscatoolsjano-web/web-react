/**
 * Quién ve Emails.
 *
 * ÚNICO lugar del frontend que lo sabe: lo usan el menú y la página. No es el
 * control de acceso —ése es `app.current_email_company_ids()` en la RLS, y el
 * JWT validado en el servicio de Cloud Run— sino no ofrecerle a nadie una
 * pantalla que va a volver vacía.
 *
 * v1: admin y employee. `assigned_to` NO suma a nadie: asignarle un hilo a un
 * vendedor no le da acceso (y el trigger ni siquiera lo permite).
 */
export const ROLES_EMAILS = ['admin', 'employee'] as const

export function puedeUsarEmails(rol: string | null | undefined): boolean {
  return !!rol && (ROLES_EMAILS as readonly string[]).includes(rol)
}
