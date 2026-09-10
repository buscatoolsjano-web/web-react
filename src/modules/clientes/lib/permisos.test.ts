import { describe, expect, it } from 'vitest'
import { permisosDe } from './permisos'
import type { Membresia } from '@/services/empresa/memberships'

const membresia = (rol: string): Membresia => ({
  companyId: 'c1',
  companyName: 'Buscatools',
  companySlug: 'buscatools',
  rol,
  esInterno: !['customer', 'distributor'].includes(rol),
  customerId: null,
})

describe('permisosDe', () => {
  it('admin puede todo', () => {
    expect(permisosDe(membresia('admin'))).toEqual({
      crearCliente: true,
      editarCliente: true,
      darDeBaja: true,
      editarContactos: true,
      editarDirecciones: true,
      editarMemoria: true,
      resolverRevision: true,
    })
  })

  it('employee puede lo mismo que admin en Clientes', () => {
    expect(permisosDe(membresia('employee'))).toEqual(permisosDe(membresia('admin')))
  })

  it('salesperson crea y edita clientes pero NO contactos ni direcciones', () => {
    const p = permisosDe(membresia('salesperson'))
    expect(p.crearCliente).toBe(true)
    expect(p.editarCliente).toBe(true)
    // `contacts_write` y `addresses_write` usan
    // `app.current_writer_company_ids()`, que es admin y employee.
    expect(p.editarContactos).toBe(false)
    expect(p.editarDirecciones).toBe(false)
    expect(p.editarMemoria).toBe(false)
    expect(p.resolverRevision).toBe(false)
  })

  it('los roles externos no escriben nada', () => {
    for (const rol of ['customer', 'distributor']) {
      const p = permisosDe(membresia(rol))
      expect(Object.values(p).every((v) => v === false)).toBe(true)
    }
  })

  it('el técnico tampoco: es interno, pero no escribe clientes', () => {
    const p = permisosDe(membresia('technician'))
    expect(Object.values(p).every((v) => v === false)).toBe(true)
  })

  it('sin membresía, nada', () => {
    const p = permisosDe(null)
    expect(Object.values(p).every((v) => v === false)).toBe(true)
  })
})
