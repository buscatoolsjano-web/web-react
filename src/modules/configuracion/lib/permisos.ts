/**
 * Quién ve Configuración y cada una de sus secciones.
 *
 * ÚNICO lugar del frontend que lo sabe: lo usan el menú, el shell y las
 * páginas. No es el control de acceso —ése lo dan las RPC `config_*` y las Edge
 * Functions, que rechazan a cualquier otro rol con `sin_permiso`— sino no
 * ofrecerle a nadie una pantalla que va a volver vacía.
 *
 *   · Usuarios:   sólo admin (Entrega 1). Adentro están los permisos por rol.
 *   · Empresa:    admin edita; employee lee (Entrega 2).
 *   · Numeración: admin y employee leen; sólo admin edita (Fase 58 · E3).
 *   · Listas de precios: admin y employee leen; nadie edita (Entrega 3).
 *   · WhatsApp · IA: sólo admin (Fase 16 · E3).
 *   · Plantillas de correo: admin y employee (Fase 41 · E2) — los mismos que
 *     pueden usar Emails, porque una plantilla no le sirve a quien no manda
 *     mails. Adentro, el envoltorio de la empresa sólo lo edita un admin y la
 *     firma propia la edita su dueño; eso lo decide la RLS, no esta lista.
 *
 * FUERA DEL MENÚ (Fase 58 · E1). Marcas, Categorías, Atributos, Auditoría y
 * Borrados salieron de la lista: once secciones hacían que no se entendiera
 * cuáles son las que importan. Las RUTAS siguen existiendo —son chunks que
 * sólo se bajan si se visitan— así que un enlace guardado no da 404 y volver
 * a mostrarlas es agregar su renglón acá. Nadie más en la app las enlaza.
 */
export const ROLES_CONFIGURACION = ['admin', 'employee'] as const

export const SECCIONES_CONFIGURACION = [
  { to: '/configuracion/empresa', label: 'Empresa', roles: ['admin', 'employee'] },
  { to: '/configuracion/numeracion', label: 'Numeración', roles: ['admin', 'employee'] },
  { to: '/configuracion/usuarios', label: 'Usuarios', roles: ['admin'] },
  { to: '/configuracion/listas-precios', label: 'Listas de precios', roles: ['admin', 'employee'] },
  // Fase 68. Entra al menú aunque Marcas y Categorías hayan salido, y la
  // diferencia es quién la mantiene: marcas y categorías llegan con la
  // sincronización del catálogo y casi nunca se tocan a mano; las formas de
  // pago las escribe la empresa, de a una, y son las que salen impresas en una
  // cotización. Employee entra porque puede agregar; administrar es de admin,
  // y eso lo decide la pantalla.
  { to: '/configuracion/formas-de-pago', label: 'Formas de pago', roles: ['admin', 'employee'] },
  { to: '/configuracion/whatsapp-ia', label: 'WhatsApp · IA', roles: ['admin'] },
  { to: '/configuracion/plantillas', label: 'Plantillas de correo', roles: ['admin', 'employee'] },
] as const

export function puedeVerConfiguracion(rol: string | null | undefined): boolean {
  return !!rol && (ROLES_CONFIGURACION as readonly string[]).includes(rol)
}

export function puedeAdministrarUsuarios(rol: string | null | undefined): boolean {
  return rol === 'admin'
}

export function puedeVerAuditoria(rol: string | null | undefined): boolean {
  return rol === 'admin'
}

export function seccionesVisibles(rol: string | null | undefined) {
  return SECCIONES_CONFIGURACION.filter((s) => !!rol && (s.roles as readonly string[]).includes(rol))
}
