import { describe, expect, it } from 'vitest'
import { permisosDe } from './permisos'
import type { Membresia } from '@/services/empresa/memberships'

const membresia = (rol: string): Membresia => ({
  companyId: 'c1',
  companyName: 'Empresa',
  companySlug: 'empresa',
  rol,
  esInterno: rol !== 'customer' && rol !== 'distributor',
  customerId: null,
})

describe('permisosDe', () => {
  it('admin y employee pueden todo', () => {
    for (const rol of ['admin', 'employee']) {
      expect(permisosDe(membresia(rol))).toEqual({
        ver: true,
        crear: true,
        editar: true,
        configurar: true,
      })
    }
  })

  it('los otros cuatro roles no pueden nada', () => {
    // `technician` incluido: existe en el CHECK de `company_memberships` pero
    // tiene cero miembros y no entró en `app.current_maintenance_company_ids()`.
    // Si se habilita, hay que tocar el helper de la base además de este
    // archivo — ocultar un botón no es el control de acceso.
    for (const rol of ['salesperson', 'technician', 'customer', 'distributor']) {
      expect(permisosDe(membresia(rol))).toEqual({
        ver: false,
        crear: false,
        editar: false,
        configurar: false,
      })
    }
  })

  it('sin membresía, tampoco', () => {
    expect(permisosDe(null)).toEqual({
      ver: false,
      crear: false,
      editar: false,
      configurar: false,
    })
  })
})
