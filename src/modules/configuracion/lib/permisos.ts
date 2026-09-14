/**
 * Quién ve Configuración y cada una de sus secciones.
 *
 * ÚNICO lugar del frontend que lo sabe: lo usan el menú, el shell y las
 * páginas. No es el control de acceso —ése lo dan las RPC `config_*` y las Edge
 * Functions, que rechazan a cualquier otro rol con `sin_permiso`— sino no
 * ofrecerle a nadie una pantalla que va a volver vacía.
 *
 *   · Usuarios:   sólo admin (Entrega 1).
 *   · Empresa:    admin edita; employee lee (Entrega 2).
 *   · Numeración: admin y employee leen; nadie edita (Entrega 2).
 */
export const ROLES_CONFIGURACION = ['admin', 'employee'] as const

export const SECCIONES_CONFIGURACION = [
  { to: '/configuracion/empresa', label: 'Empresa', roles: ['admin', 'employee'] },
  { to: '/configuracion/numeracion', label: 'Numeración', roles: ['admin', 'employee'] },
  { to: '/configuracion/usuarios', label: 'Usuarios', roles: ['admin'] },
] as const

export function puedeVerConfiguracion(rol: string | null | undefined): boolean {
  return !!rol && (ROLES_CONFIGURACION as readonly string[]).includes(rol)
}

export function puedeAdministrarUsuarios(rol: string | null | undefined): boolean {
  return rol === 'admin'
}

export function seccionesVisibles(rol: string | null | undefined) {
  return SECCIONES_CONFIGURACION.filter((s) => !!rol && (s.roles as readonly string[]).includes(rol))
}
