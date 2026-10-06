import { describe, expect, it } from 'vitest'
import { filtrarContactosDelCliente } from './vistaContactos'
import type { ContactoCliente } from '../types'

/**
 * Buscar un contacto dentro de la ficha del cliente (Fase 40).
 *
 * El filtro es en memoria y no contra el servidor, a propósito: los contactos
 * del cliente ya están cargados y son pocos —87 entre 30 clientes, promedio
 * 2,9—. Los 22 del más poblado son el motivo de que exista el buscador.
 */
const contacto = (p: Partial<ContactoCliente> & { id: string; nombre: string }): ContactoCliente => ({
  cargo: null,
  email: null,
  telefono: null,
  fax: null,
  esPrincipal: false,
  notas: null,
  activo: true,
  actualizadoEn: '2026-09-16T00:00:00Z',
  ...p,
})

const CONTACTOS: ContactoCliente[] = [
  contacto({ id: 'k1', nombre: 'Ana Pérez', cargo: 'Compras', email: 'ana@acme.com', telefono: '+54 9 11 4471-5959' }),
  contacto({ id: 'k2', nombre: 'Juan Gómez', cargo: 'Ingeniería de Procesos', email: 'juan@acme.com' }),
  contacto({ id: 'k3', nombre: 'Matías Lamas', cargo: 'Pagos' }),
]

const nombres = (texto: string) => filtrarContactosDelCliente(CONTACTOS, texto).map((c) => c.nombre)

describe('Buscar entre los contactos del cliente', () => {
  it('sin texto están todos', () => {
    expect(nombres('')).toHaveLength(3)
    expect(nombres('   ')).toHaveLength(3)
  })

  it('por nombre', () => {
    expect(nombres('lamas')).toEqual(['Matías Lamas'])
  })

  /** «Pérez» tiene que encontrarse escribiendo «perez»: nadie pone la tilde. */
  it('sin tildes y sin distinguir mayúsculas', () => {
    expect(nombres('PEREZ')).toEqual(['Ana Pérez'])
    expect(nombres('matias')).toEqual(['Matías Lamas'])
  })

  it('por cargo y por email', () => {
    expect(nombres('procesos')).toEqual(['Juan Gómez'])
    expect(nombres('ana@')).toEqual(['Ana Pérez'])
  })

  /**
   * El teléfono por dígitos: nadie se acuerda de si lo cargaron con guiones,
   * paréntesis, espacios o el código de país.
   */
  it('por teléfono, sin importar cómo esté escrito', () => {
    expect(nombres('44715959')).toEqual(['Ana Pérez'])
    expect(nombres('4471-5959')).toEqual(['Ana Pérez'])
  })

  /** Dos dígitos son cualquier teléfono: no es una búsqueda. */
  it('menos de tres dígitos no busca por teléfono', () => {
    expect(nombres('44')).toEqual([])
  })

  it('lo que no coincide con nada devuelve vacío, no todo', () => {
    expect(nombres('zzzz')).toEqual([])
  })
})
