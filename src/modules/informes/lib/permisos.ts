/**
 * Quién ve Informes.
 *
 * ÚNICO lugar del frontend que lo sabe: lo usan el menú y la página. No es el
 * control de acceso —ése es `informe_actividad_comercial`, que rechaza con
 * `sin_permiso` a cualquier otro rol antes de leer— sino no ofrecerle a nadie
 * una pantalla que va a volver vacía.
 *
 * v1: admin y employee. La RLS de ventas le deja leer documentos también a
 * salesperson y technician; Informes, no (decisión de la entrega 1).
 */
export const ROLES_INFORMES = ['admin', 'employee'] as const

export function puedeVerInformes(rol: string | null | undefined): boolean {
  return !!rol && (ROLES_INFORMES as readonly string[]).includes(rol)
}
