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
  borrar: vi.fn((_id: string, _opciones?: unknown) => {}),
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
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Desactivarlo' }))

    // Lo que se manda es un guardado con activo en falso, NO otro borrado.
    expect(mut.borrar).not.toHaveBeenCalled()
    expect(mut.guardar).toHaveBeenCalledTimes(1)
    expect(llamada().datos.activo).toBe(false)
  })

  it('sin referencias, Borrar borra de verdad', () => {
    montar([contacto()])
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Borrar contacto' }))
    expect(mut.borrar).toHaveBeenCalledWith('k1', expect.anything())
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
