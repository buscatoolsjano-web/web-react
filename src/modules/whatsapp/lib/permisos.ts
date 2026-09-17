/**
 * Quién usa WhatsApp.
 *
 * ÚNICO lugar del frontend que lo sabe: lo usan el menú y la página. NO es el
 * control de acceso —ése es la RLS, con `app.puede_ver_conversacion_wa()`—
 * sino no ofrecerle a nadie una pantalla que va a volver vacía.
 *
 * `salesperson` entra, a diferencia de Emails: en WhatsApp la asignación SÍ da
 * acceso, y un vendedor ve las conversaciones que tiene asignadas. Lo que no
 * puede es asignarse solo (no hay `UPDATE` sobre la tabla para nadie).
 *
 * `technician`, `customer` y `distributor` no entran. La base tampoco los deja.
 */
export const ROLES_WHATSAPP = ['admin', 'employee', 'salesperson'] as const

export function puedeUsarWhatsapp(rol: string | null | undefined): boolean {
  return !!rol && (ROLES_WHATSAPP as readonly string[]).includes(rol)
}

/** Configurar la IA de WhatsApp y ver su uso y costo es sólo de admin (Fase 16 · E3). */
export function puedeConfigurarIA(rol: string | null | undefined): boolean {
  return rol === 'admin'
}

/** Asignar y desasignar es de admin y employee: la RPC valida lo mismo. */
export const ROLES_ASIGNAN = ['admin', 'employee'] as const

export function puedeAsignar(rol: string | null | undefined): boolean {
  return !!rol && (ROLES_ASIGNAN as readonly string[]).includes(rol)
}
