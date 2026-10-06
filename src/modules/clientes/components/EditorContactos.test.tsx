// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ContactoCliente } from '../types'
import type { DatosContacto } from '../lib/validacion'

/**
 * Los contactos del cliente (Fase 17 · E3).
 *
 * Lo que se prueba acá no es que aparezcan los campos: es el contrato con el
 * servidor. Una sola llamada por guardado, con el testigo de concurrencia; el
 * principal no se baja desde el navegador; y un contacto que ya figura en un
 * documento se desactiva en vez de borrarse —incluso si alguien apretó Borrar—.
 */

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

const estado = vi.hoisted(() => ({
  guardarError: null as Error | null,
  borrarError: null as Error | null,
}))
interface Guardado {
  id: string | null
  esperado: string | null
  datos: DatosContacto
}
const mut = vi.hoisted(() => ({
  guardar: vi.fn((_v: { id: string | null; esperado: string | null; datos: unknown }) => {}),
  borrar: vi.fn((_v: { id: string; motivo: string }, _opciones?: unknown) => {}),
  reset: vi.fn(),
}))
/** El argumento de la n-ésima llamada, con su forma real. */
const llamada = (n = 0): Guardado => mut.guardar.mock.calls[n]![0] as Guardado

vi.mock('../hooks/useEdicionClientes', () => ({
  useContactosEdicion: () => ({
    guardar: { mutate: mut.guardar, isPending: false, error: estado.guardarError },
    borrar: { mutate: mut.borrar, isPending: false, error: estado.borrarError, reset: mut.reset },
  }),
}))

const { EditorContactos } = await import('./EditorContactos')
const { FalloDeAgenda } = await import('../services/edicion')

const contacto = (p: Partial<ContactoCliente> = {}): ContactoCliente => ({
  id: 'k1',
  nombre: 'ZZ Ana Pérez',
  cargo: 'Compras',
  email: 'ana@zz.test',
  telefono: null,
  fax: null,
  esPrincipal: true,
  notas: null,
  activo: true,
  actualizadoEn: '2026-09-17T10:00:00Z',
  ...p,
})

const montar = (contactos: ContactoCliente[], puedeEditar = true) =>
  render(
    <EditorContactos
      clienteId="c1"
      contactos={contactos}
      cargando={false}
      puedeEditar={puedeEditar}
      onRecargar={() => {}}
    />,
  )

const escribir = (etiqueta: RegExp, valor: string) =>
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } })

beforeEach(() => {
  // La vista elegida se guarda en localStorage a propósito —quien trabaja con
  // el cliente de 22 contactos quiere la lista siempre—, así que acá hay que
  // limpiarla: si no, el caso que toca «Lista» le cambia la vista al siguiente.
  try {
    localStorage.clear()
  } catch {
    /* jsdom siempre lo tiene; en un navegador bloqueado, no pasa nada */
  }
  estado.guardarError = null
  estado.borrarError = null
  vi.clearAllMocks()
})

describe('EditorContactos · guardado atómico', () => {
  it('el alta manda UNA llamada, sin id y sin testigo: no hay fila que versionar', () => {
    montar([])
    fireEvent.click(screen.getByRole('button', { name: /agregar contacto/i }))
    escribir(/nombre/i, 'ZZ Nueva')
    fireEvent.click(screen.getByRole('button', { name: 'Agregar contacto' }))

    expect(mut.guardar).toHaveBeenCalledTimes(1)
    const arg = llamada()
    expect(arg.id).toBeNull()
    expect(arg.esperado).toBeNull()
    expect(arg.datos.nombre).toBe('ZZ Nueva')
    expect(arg.datos.activo).toBe(true)
  })

  it('el primer contacto nace principal; con uno activo ya cargado, no', () => {
    const vista = montar([])
    fireEvent.click(screen.getByRole('button', { name: /agregar contacto/i }))
    expect(screen.getByRole('checkbox', { name: /contacto principal/i })).toBeChecked()
    vista.unmount()

    montar([contacto()])
    fireEvent.click(screen.getByRole('button', { name: /agregar contacto/i }))
    expect(screen.getByRole('checkbox', { name: /contacto principal/i })).not.toBeChecked()
  })

  it('la edición viaja con el testigo de concurrencia que se leyó', () => {
    montar([contacto()])
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    escribir(/cargo/i, 'Gerencia')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(mut.guardar).toHaveBeenCalledTimes(1)
    const arg = llamada()
    expect(arg.id).toBe('k1')
    expect(arg.esperado).toBe('2026-09-17T10:00:00Z')
    expect(arg.datos.cargo).toBe('Gerencia')
  })

  it('marcar principal NO baja al anterior desde el navegador: es una sola llamada', () => {
    montar([contacto({ id: 'k1' }), contacto({ id: 'k2', nombre: 'ZZ Beto', esPrincipal: false })])
    const beto = screen.getByText('ZZ Beto').closest('li')!
    fireEvent.click(within(beto).getByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /contacto principal/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(mut.guardar).toHaveBeenCalledTimes(1)
    expect(llamada().datos.esPrincipal).toBe(true)
  })

  it('un contacto sin nombre no llega al servidor', () => {
    montar([])
    fireEvent.click(screen.getByRole('button', { name: /agregar contacto/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Agregar contacto' }))
    expect(mut.guardar).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('nombre del contacto es obligatorio')
  })
})

describe('EditorContactos · desactivar en vez de borrar', () => {
  it('Desactivar manda un guardado con activo en falso, sin pedir confirmación', () => {
    montar([contacto()])
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar' }))
    expect(mut.guardar).toHaveBeenCalledTimes(1)
    const arg = llamada()
    expect(arg.id).toBe('k1')
    expect(arg.datos.activo).toBe(false)
  })

  it('un contacto desactivado se ve, marcado, y se puede reactivar', () => {
    montar([contacto({ activo: false, esPrincipal: false })])
    expect(screen.getByText('Desactivado')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar' }))
    expect(llamada().datos.activo).toBe(true)
  })

  it('desactivar al principal le quita la marca en el formulario: es la regla del servidor', () => {
    montar([contacto()])
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('checkbox', { name: /contacto principal/i })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: /^activo$/i }))
    const principal = screen.getByRole('checkbox', { name: /contacto principal/i })
    expect(principal).not.toBeChecked()
    expect(principal).toBeDisabled()
  })

  it('si el servidor dice que está referenciado, el diálogo pasa a ofrecer desactivarlo', () => {
    estado.borrarError = new FalloDeAgenda('CONTACTO_REFERENCIADO', 'Figura en documentos.')
    montar([contacto()])
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }))

    // tone="danger" → `alertdialog`, que es lo correcto para una confirmación
    // destructiva.
    const dialogo = screen.getByRole('alertdialog')
    expect(within(dialogo).getByText(/no se puede borrar/i)).toBeInTheDocument()
    // Fase 40: también acá hay que decir por qué. Para el cliente del otro
    // lado del teléfono el contacto desapareció igual.
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Era una prueba' }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Desactivarlo' }))

    // Lo que se manda es un guardado con activo en falso, NO otro borrado.
    expect(mut.borrar).not.toHaveBeenCalled()
    expect(mut.guardar).toHaveBeenCalledTimes(1)
    expect(llamada().datos.activo).toBe(false)
  })

  it('sin referencias, Borrar borra de verdad, con el motivo', () => {
    montar([contacto()])
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }))

    // Sin motivo el borrado no sale: es lo único que queda cuando el contacto
    // ya no está, y la base lo exige igual (DELETION_REASON_REQUIRED).
    const confirmar = screen.getByRole('button', { name: 'Borrar contacto' })
    expect(confirmar).toBeDisabled()
    fireEvent.click(confirmar)
    expect(mut.borrar).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Está duplicado' }))
    fireEvent.click(confirmar)
    expect(mut.borrar).toHaveBeenCalledWith({ id: 'k1', motivo: 'Está duplicado' }, expect.anything())
  })
})

describe('EditorContactos · conflictos y permisos', () => {
  it('un conflicto ofrece recargar y NO cierra el formulario', () => {
    estado.guardarError = new FalloDeAgenda('CONFLICTO_DE_EDICION', 'Alguien más lo guardó.')
    montar([contacto()])
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    const alerta = screen.getByRole('alert')
    expect(alerta).toHaveTextContent('Alguien más lo guardó.')
    expect(within(alerta).getByRole('button', { name: 'Recargar' })).toBeInTheDocument()
    // El borrador sigue en pantalla: no se perdió lo escrito.
    expect(screen.getByLabelText(/nombre/i)).toHaveValue('ZZ Ana Pérez')
  })

  it('quien no administra la agenda no ve ningún botón de escritura', () => {
    montar([contacto()], false)
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /agregar contacto/i })).not.toBeInTheDocument()
    // Pero los contactos se leen igual.
    expect(screen.getByText('ZZ Ana Pérez')).toBeInTheDocument()
  })
})

/*
 * Verlos en lista, y encontrar a alguien entre muchos (Fase 40).
 *
 * Las tarjetas son mejores para leer una ficha —el nombre grande, el mail
 * clickeable, las notas enteras—, pero el cliente más poblado del maestro
 * tiene 22 contactos y en tarjetas ocupan tres pantallas.
 */
describe('EditorContactos · lista y búsqueda', () => {
  const varios = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      contacto({
        id: `k${i}`,
        nombre: `ZZ Persona ${i}`,
        cargo: i === 0 ? 'Compras' : 'Ingeniería',
        email: `p${i}@zz.test`,
        esPrincipal: i === 0,
      }),
    )

  it('arranca en tarjetas y no hay tabla', () => {
    montar(varios(3))
    expect(screen.getByRole('button', { name: /Tarjetas/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('«Lista» muestra una tabla con una fila por contacto', () => {
    montar(varios(3))
    fireEvent.click(screen.getByRole('button', { name: /Lista/ }))

    const tabla = screen.getByRole('table', { name: 'Contactos del cliente' })
    // Tres contactos más el encabezado.
    expect(within(tabla).getAllByRole('row')).toHaveLength(4)
    expect(within(tabla).getByRole('columnheader', { name: 'Email' })).toBeInTheDocument()
  })

  /**
   * Con tres contactos un campo de búsqueda es un control de más que hay que
   * mirar y descartar. El umbral sale de los datos: el promedio real es 2,9.
   */
  it('el buscador aparece recién cuando hay varios', () => {
    const { unmount } = montar(varios(3))
    expect(screen.queryByRole('searchbox', { name: /buscar contacto/i })).not.toBeInTheDocument()
    unmount()

    montar(varios(6))
    expect(screen.getByRole('searchbox', { name: /buscar contacto/i })).toBeInTheDocument()
  })

  it('buscar deja sólo los que coinciden, y lo dice cuando no hay ninguno', () => {
    montar(varios(6))
    const buscador = screen.getByRole('searchbox', { name: /buscar contacto/i })

    fireEvent.change(buscador, { target: { value: 'Persona 4' } })
    expect(screen.getByText('ZZ Persona 4')).toBeInTheDocument()
    expect(screen.queryByText('ZZ Persona 3')).not.toBeInTheDocument()

    fireEvent.change(buscador, { target: { value: 'zzzz' } })
    expect(screen.getByText(/Ningún contacto coincide/)).toBeInTheDocument()
  })

  /**
   * El formulario es el MISMO en las dos vistas, inyectado por prop: dos
   * formularios para el mismo contacto terminarían en dos validaciones
   * distintas y en un campo que existe en una vista y no en la otra.
   */
  it('en lista también se edita, con el mismo formulario', () => {
    montar(varios(3))
    fireEvent.click(screen.getByRole('button', { name: /Lista/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Editar ZZ Persona 1' }))
    expect(screen.getByLabelText(/nombre/i)).toHaveValue('ZZ Persona 1')
  })
})
