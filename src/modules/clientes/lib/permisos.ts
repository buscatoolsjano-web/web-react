import type { Membresia } from '@/services/empresa/memberships'

/**
 * Qué puede hacer cada rol en Clientes.
 *
 * Esto NO es el control de acceso: lo que impide escribir son las policies.
 * Acá sólo se decide qué botones tiene sentido mostrar, para no ofrecer una
 * acción que la base va a rechazar.
 *
 * Los permisos siguen a las policies:
 *
 *   `customers_insert` / `customers_update`  admin, employee y salesperson
 *                                            —el vendedor, sólo los clientes
 *                                            que tiene asignados.
 *   `contacts_write` / `addresses_write`     `app.puede_administrar_cliente()`:
 *                                            admin y employee, más el vendedor
 *                                            del cliente (Fase 17 · E3).
 *   `aliases_write`                          `current_writer_company_ids()`, que
 *                                            es admin y employee, más poder
 *                                            leer al cliente.
 *   `resolver_revision_cliente`              admin y employee.
 *
 * La agenda del cliente —contactos y direcciones— es el único permiso que
 * depende del cliente y no sólo del rol: hay que pasarle el `cliente`. Sin él,
 * un vendedor no lo tiene, que es el lado seguro del error: la policy lo
 * dejaría, y lo peor que pasa es que no se muestre un botón que sí podía usar.
 *
 * No hay policy de DELETE sobre `customers`: desde la aplicación un cliente no
 * se borra nunca, ni con permiso. Se da de baja.
 */

const ESCRIBEN_CLIENTE = ['admin', 'employee', 'salesperson']
const ESCRIBEN_TODO = ['admin', 'employee']

/** Lo mínimo que hay que saber del cliente para resolver la agenda. */
export interface ClienteParaPermisos {
  /** `customers.salesperson_id`. Vacío = sin vendedor asignado. */
  vendedorId: string | null
}

export interface PermisosClientes {
  crearCliente: boolean
  editarCliente: boolean
  darDeBaja: boolean
  editarContactos: boolean
  editarDirecciones: boolean
  editarMemoria: boolean
  resolverRevision: boolean
}

export function permisosDe(
  membresia: Membresia | null,
  cliente: ClienteParaPermisos | null = null,
  usuarioId: string | null = null,
): PermisosClientes {
  const rol = membresia?.rol ?? ''
  const escribeCliente = ESCRIBEN_CLIENTE.includes(rol)
  const escribeTodo = ESCRIBEN_TODO.includes(rol)
  // El vendedor administra la agenda de los clientes que tiene asignados: es
  // quien habla con esas personas. Requiere saber de qué cliente se trata y
  // quién está mirando.
  const esSuCliente =
    rol === 'salesperson' &&
    usuarioId !== null &&
    cliente !== null &&
    cliente.vendedorId === usuarioId
  const administraAgenda = escribeTodo || esSuCliente
  return {
    crearCliente: escribeCliente,
    editarCliente: escribeCliente,
    // Dar de baja es un UPDATE, así que va con el mismo permiso que editar.
    darDeBaja: escribeCliente,
    editarContactos: administraAgenda,
    editarDirecciones: administraAgenda,
    editarMemoria: escribeTodo,
    resolverRevision: escribeTodo,
  }
}
