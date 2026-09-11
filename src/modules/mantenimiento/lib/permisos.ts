import type { Membresia } from '@/services/empresa/memberships'

/**
 * Qué puede hacer cada rol en Mantenimiento.
 *
 * **Admin y employee, nadie más.** Es la decisión de la entrega 1: el rol
 * `technician` existe en el CHECK de `company_memberships` pero tiene cero
 * miembros, y el legacy trataba igual a los seis de su lista blanca, así que
 * no hay evidencia de un rol técnico acotado. Cuando exista alguien con ese
 * rol y un flujo real, se habilita con una línea acá y otra en el helper.
 *
 * Esto NO es el control de acceso: lo que protege los datos es la RLS. Las
 * ocho tablas usan `app.current_maintenance_company_ids()`, así que un
 * salesperson que escriba la URL a mano llega a una pantalla vacía.
 */
const ESCRIBEN = ['admin', 'employee']

export interface PermisosMantenimiento {
  ver: boolean
  crear: boolean
  editar: boolean
  configurar: boolean
}

export function permisosDe(membresia: Membresia | null): PermisosMantenimiento {
  const escribe = ESCRIBEN.includes(membresia?.rol ?? '')
  return {
    // Ver y escribir son el mismo conjunto: las policies de lectura y de
    // escritura devuelven hoy exactamente lo mismo.
    ver: escribe,
    crear: escribe,
    editar: escribe,
    // Los puntos de revisión son configuración de la empresa, mismo permiso.
    configurar: escribe,
  }
}
