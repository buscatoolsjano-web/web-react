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
 *
 * TODO LO DE CORREO SE MUDÓ A EMAILS (Fase 167). «Plantillas de correo» y
 * «Reglas de correo» salieron de acá y viven en la sección Emails, al lado de
 * las etiquetas: una plantilla y una regla son del que trabaja con el correo,
 * no de Configuración. «WhatsApp · IA» salió del menú por ahora —no va más por
 * ahora— aunque su ruta sigue existiendo por URL. Las tres se reabren sumando
 * su renglón de vuelta a la lista.
 *
 * FUERA DEL MENÚ (Fase 58 · E1). Marcas, Categorías, Atributos y Auditoría
 * salieron de la lista: once secciones hacían que no se entendiera cuáles son
 * las que importan. Borrados salió con ellas y volvió en la Fase 74, porque
 * no era como las otras: las demás se miran una vez por año y «qué se borró y
 * quién lo borró» se busca justo cuando falta algo y hay apuro.
 *
 * Las RUTAS de las que siguen afuera existen igual —son chunks que
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
  // WhatsApp · IA, Plantillas de correo y Reglas de correo salieron de acá en la
  // Fase 167 (ver el encabezado): las dos de correo viven ahora en Emails.
  // Fase 154: plantillas de impresión (Packing List y las que los admins armen).
  { to: '/configuracion/plantillas-impresion', label: 'Plantillas de impresión', roles: ['admin', 'employee'] },
  // Fase 74: vuelve al menú. Una pantalla a la que sólo se llega sabiendo la
  // URL de memoria no existe el día que hace falta, y a ésta se la busca con
  // apuro. Ver el encabezado.
  { to: '/configuracion/borrados', label: 'Borrados', roles: ['admin', 'employee'] },
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
