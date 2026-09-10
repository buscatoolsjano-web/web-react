import type { Membresia } from '@/services/empresa/memberships'

/**
 * Qué puede hacer cada rol en Clientes.
 *
 * Esto NO es el control de acceso: lo que impide escribir son las policies.
 * Acá sólo se decide qué botones tiene sentido mostrar, para no ofrecer una
 * acción que la base va a rechazar.
 *
 * Los permisos son los que el modelo ya tenía; no se amplió ninguno:
 *
 *   `customers_insert` / `customers_update`  admin, employee y salesperson
 *                                            —el vendedor, sólo los clientes
 *                                            que tiene asignados.
 *   `contacts_write` / `addresses_write`     `app.current_writer_company_ids()`,
 *                                            que es admin y employee.
 *   `aliases_write`                          la misma función, más poder leer
 *                                            al cliente.
 *   `resolver_revision_cliente`              admin y employee.
 *
 * No hay policy de DELETE sobre `customers`: desde la aplicación un cliente no
 * se borra nunca, ni con permiso. Se da de baja.
 */

const ESCRIBEN_CLIENTE = ['admin', 'employee', 'salesperson']
const ESCRIBEN_TODO = ['admin', 'employee']

export interface PermisosClientes {
  crearCliente: boolean
  editarCliente: boolean
  darDeBaja: boolean
  editarContactos: boolean
  editarDirecciones: boolean
  editarMemoria: boolean
  resolverRevision: boolean
}

export function permisosDe(membresia: Membresia | null): PermisosClientes {
  const rol = membresia?.rol ?? ''
  const escribeCliente = ESCRIBEN_CLIENTE.includes(rol)
  const escribeTodo = ESCRIBEN_TODO.includes(rol)
  return {
    crearCliente: escribeCliente,
    editarCliente: escribeCliente,
    // Dar de baja es un UPDATE, así que va con el mismo permiso que editar.
    darDeBaja: escribeCliente,
    editarContactos: escribeTodo,
    editarDirecciones: escribeTodo,
    editarMemoria: escribeTodo,
    resolverRevision: escribeTodo,
  }
}
