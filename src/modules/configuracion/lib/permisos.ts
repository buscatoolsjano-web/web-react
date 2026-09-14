/**
 * Quién ve Configuración.
 *
 * ÚNICO lugar del frontend que lo sabe: lo usan el menú y las páginas. No es
 * el control de acceso —ése lo dan `config_listar_usuarios`,
 * `config_cambiar_rol`, `config_cambiar_estado` y la Edge Function
 * `config-usuarios`, que rechazan a cualquier otro rol con `sin_permiso`—
 * sino no ofrecerle a nadie una pantalla que va a volver vacía.
 *
 * v1: sólo admin. Employee no administra usuarios.
 */
export const ROLES_CONFIGURACION = ['admin'] as const

export function puedeVerConfiguracion(rol: string | null | undefined): boolean {
  return !!rol && (ROLES_CONFIGURACION as readonly string[]).includes(rol)
}
