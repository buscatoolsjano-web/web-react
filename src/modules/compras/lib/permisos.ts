import type { Membresia } from '@/services/empresa/memberships'

/**
 * Qué puede hacer cada rol en Compras.
 *
 * Esto NO es el control de acceso: lo que impide leer y escribir son las
 * policies. Acá sólo se decide qué botones tiene sentido mostrar.
 *
 * Compras es **admin y employee**, y nadie más. Las ocho tablas usan
 * `app.current_writer_company_ids()` en el USING y en el WITH CHECK, así que
 * un salesperson no ve ni los proveedores de su propia empresa: el listado le
 * vuelve vacío. Es deliberado y está probado.
 *
 * Ojo con la diferencia respecto de Clientes: allá `customers_insert` incluye
 * a salesperson. Acá no. No se amplió nada por simetría.
 */

const ESCRIBEN = ['admin', 'employee']

export interface PermisosCompras {
  verProveedores: boolean
  crearProveedor: boolean
  editarProveedor: boolean
  darDeBaja: boolean
  editarAdjuntos: boolean
  resolverRevision: boolean
}

export function permisosDe(membresia: Membresia | null): PermisosCompras {
  const escribe = ESCRIBEN.includes(membresia?.rol ?? '')
  return {
    // Ver y escribir son el mismo conjunto: la policy es `FOR ALL`.
    verProveedores: escribe,
    crearProveedor: escribe,
    editarProveedor: escribe,
    // Dar de baja es un UPDATE, así que va con el mismo permiso que editar.
    darDeBaja: escribe,
    editarAdjuntos: escribe,
    resolverRevision: escribe,
  }
}
