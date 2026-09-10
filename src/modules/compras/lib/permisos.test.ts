import { describe, expect, it } from 'vitest'
import type { Membresia } from '@/services/empresa/memberships'
import { permisosDe } from './permisos'

const membresia = (rol: string): Membresia => ({
  companyId: 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c',
  companyName: 'Buscatools',
  companySlug: 'buscatools',
  rol,
  esInterno: ['admin', 'employee', 'salesperson', 'technician'].includes(rol),
  customerId: null,
})

describe('permisosDe', () => {
  it('admin puede todo', () => {
    expect(permisosDe(membresia('admin'))).toEqual({
      verProveedores: true,
      crearProveedor: true,
      editarProveedor: true,
      darDeBaja: true,
      editarAdjuntos: true,
      resolverRevision: true,
    })
  })

  it('employee también: es el mismo conjunto de la RLS', () => {
    expect(permisosDe(membresia('employee'))).toEqual(permisosDe(membresia('admin')))
  })

  it.each(['salesperson', 'technician', 'customer', 'distributor'])(
    '%s no ve ni escribe nada de Compras',
    (rol) => {
      const p = permisosDe(membresia(rol))
      expect(Object.values(p).every((v) => v === false)).toBe(true)
    },
  )

  it('sin membresía tampoco', () => {
    const p = permisosDe(null)
    expect(Object.values(p).every((v) => v === false)).toBe(true)
  })

  it('un rol desconocido no hereda permisos por las dudas', () => {
    const p = permisosDe(membresia('lo-que-sea'))
    expect(Object.values(p).every((v) => v === false)).toBe(true)
  })

  it('salesperson SÍ escribe clientes pero NO proveedores', () => {
    // La diferencia con Clientes es deliberada: allá `customers_insert`
    // incluye a salesperson; acá `suppliers` es `current_writer_company_ids()`.
    expect(permisosDe(membresia('salesperson')).crearProveedor).toBe(false)
  })
})
