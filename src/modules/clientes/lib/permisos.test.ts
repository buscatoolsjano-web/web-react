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

  it('salesperson crea y edita clientes; sin saber de qué cliente, no administra su agenda', () => {
    const p = permisosDe(membresia('salesperson'))
    expect(p.crearCliente).toBe(true)
    expect(p.editarCliente).toBe(true)
    // Sin el cliente no se puede saber si es el suyo, y no se adivina.
    expect(p.editarContactos).toBe(false)
    expect(p.editarDirecciones).toBe(false)
    expect(p.editarMemoria).toBe(false)
    expect(p.resolverRevision).toBe(false)
  })

  // Fase 17 · E3: `app.puede_administrar_cliente()` dejó entrar al vendedor del
  // cliente. Lo de abajo es exactamente esa regla, del lado de los botones.
  it('salesperson administra la agenda de SU cliente', () => {
    const p = permisosDe(membresia('salesperson'), { vendedorId: 'u1' }, 'u1')
    expect(p.editarContactos).toBe(true)
    expect(p.editarDirecciones).toBe(true)
    // La memoria de productos y la revisión siguen siendo de admin y employee.
    expect(p.editarMemoria).toBe(false)
    expect(p.resolverRevision).toBe(false)
  })

  it('pero no la de un cliente de otro vendedor, ni de uno sin vendedor', () => {
    expect(permisosDe(membresia('salesperson'), { vendedorId: 'u2' }, 'u1').editarContactos).toBe(
      false,
    )
    expect(permisosDe(membresia('salesperson'), { vendedorId: null }, 'u1').editarContactos).toBe(
      false,
    )
    // Y si no se sabe quién está mirando, tampoco.
    expect(permisosDe(membresia('salesperson'), { vendedorId: 'u1' }, null).editarContactos).toBe(
      false,
    )
  })

  it('al admin no le cambia nada que el cliente sea de otro vendedor', () => {
    const p = permisosDe(membresia('admin'), { vendedorId: 'u2' }, 'u1')
    expect(p.editarContactos).toBe(true)
    expect(p.editarDirecciones).toBe(true)
  })

  it('el técnico no administra la agenda ni de un cliente que tuviera asignado', () => {
    expect(permisosDe(membresia('technician'), { vendedorId: 'u1' }, 'u1').editarContactos).toBe(
      false,
    )
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
