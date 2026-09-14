/**
 * Quién ESCRIBE en Ventas.
 *
 * Esto NO es el control de acceso: lo que impide escribir son las policies
 * `quotes_write`, `orders_write`, `deliveries_write`, sus líneas y
 * `attachments_write`, todas con `app.current_writer_company_ids()`
 * (admin + employee), y `next_document_number` con el mismo conjunto.
 *
 * Hasta la Fase 13 los botones se mostraban a cualquier rol interno, así que
 * un vendedor o un técnico veían «+ Nueva», «Editar» o «Eliminar» y la base
 * los rechazaba. Acá sólo se alinea la interfaz con esa regla: no se amplía ni
 * se restringe nada.
 *
 * Leer sigue siendo de todos los internos (y del cliente, su propio documento).
 */
export const ROLES_ESCRITURA_VENTAS = ['admin', 'employee'] as const

export function escribeVentas(rol: string | null | undefined): boolean {
  return !!rol && (ROLES_ESCRITURA_VENTAS as readonly string[]).includes(rol)
}
