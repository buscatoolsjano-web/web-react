// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { DireccionCliente } from '../types'
import type { DatosDireccion } from '../lib/validacion'

/**
 * Las direcciones del cliente (Fase 17 · E3).
 *
 * Desde esta entrega una dirección no es un dato de la ficha: es **a dónde se
 * entrega**. Por eso lo que se prueba es que la principal se resuelva por tipo,
 * que una dirección que ya figura en un pedido se desactive en vez de borrarse,
 * y que el guardado sea uno solo y con testigo.
 */

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

const estado = vi.hoisted(() => ({
  guardarError: null as Error | null,
  borrarError: null as Error | null,
}))
interface Guardado {
  id: string | null
  esperado: string | null
  datos: DatosDireccion
}
const mut = vi.hoisted(() => ({
  guardar: vi.fn((_v: { id: string | null; esperado: string | null; datos: unknown }) => {}),
  borrar: vi.fn((_id: string, _opciones?: unknown) => {}),
  reset: vi.fn(),
}))
const llamada = (n = 0): Guardado => mut.guardar.mock.calls[n]![0] as Guardado

vi.mock('../hooks/useEdicionClientes', () => ({
  useDireccionesEdicion: () => ({
    guardar: { mutate: mut.guardar, isPending: false, error: estado.guardarError },
    borrar: { mutate: mut.borrar, isPending: false, error: estado.borrarError, reset: mut.reset },
  }),
}))

const { EditorDirecciones } = await import('./EditorDirecciones')
const { FalloDeAgenda } = await import('../services/edicion')

const direccion = (p: Partial<DireccionCliente> = {}): DireccionCliente => ({
  id: 'd1',
  tipo: 'shipping',
  calle: 'Av. Siempreviva 742',
  ciudad: 'Springfield',
  provincia: null,
  codigoPostal: 'B1636',
  pais: 'AR',
  notas: null,
  esPrincipal: true,
  texto: 'Av. Siempreviva 742, Springfield, B1636, AR',
  activo: true,
  actualizadoEn: '2026-09-17T10:00:00Z',
  ...p,
})

const montar = (direcciones: DireccionCliente[], puedeEditar = true) =>
  render(
    <EditorDirecciones
      clienteId="c1"
      direcciones={direcciones}
      cargando={false}
      puedeEditar={puedeEditar}
      onRecargar={() => {}}
    />,
  )

beforeEach(() => {
  estado.guardarError = null
  estado.borrarError = null
  vi.clearAllMocks()
})

describe('EditorDirecciones · guardado atómico', () => {
  it('el alta manda UNA llamada, sin id ni testigo, con el tipo elegido', () => {
    montar([])
    fireEvent.click(screen.getByRole('button', { name: /agregar dirección/i }))
    fireEvent.change(screen.getByLabelText(/calle y número/i), {
      target: { value: 'Calle Falsa 123' },
    })
    fireEvent.change(screen.getByLabelText(/^tipo/i), { target: { value: 'billing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar dirección' }))

    expect(mut.guardar).toHaveBeenCalledTimes(1)
    const arg = llamada()
    expect(arg.id).toBeNull()
    expect(arg.esperado).toBeNull()
    expect(arg.datos).toMatchObject({ tipo: 'billing', calle: 'Calle Falsa 123', activo: true })
  })

  it('la primera dirección de entrega nace principal; si ya hay una activa, no', () => {
    const vista = montar([])
    fireEvent.click(screen.getByRole('button', { name: /agregar dirección/i }))
    expect(screen.getByRole('checkbox', { name: /principal para este tipo/i })).toBeChecked()
    vista.unmount()

    montar([direccion()])
    fireEvent.click(screen.getByRole('button', { name: /agregar dirección/i }))
    expect(screen.getByRole('checkbox', { name: /principal para este tipo/i })).not.toBeChecked()
  })

  it('una dirección de OTRO tipo no cuenta para el principal del tipo nuevo', () => {
    // El formulario nuevo abre en «Entrega»: que exista una de facturación no
    // significa que ya haya principal de entrega.
    montar([direccion({ tipo: 'billing' })])
    fireEvent.click(screen.getByRole('button', { name: /agregar dirección/i }))
    expect(screen.getByRole('checkbox', { name: /principal para este tipo/i })).toBeChecked()
  })

  it('la edición viaja con el testigo que se leyó', () => {
    montar([direccion()])
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText(/ciudad/i), { target: { value: 'Shelbyville' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    const arg = llamada()
    expect(arg.id).toBe('d1')
    expect(arg.esperado).toBe('2026-09-17T10:00:00Z')
    expect(arg.datos.ciudad).toBe('Shelbyville')
  })

  it('sin calle no se manda nada, y un país de tres letras tampoco', () => {
    montar([])
    fireEvent.click(screen.getByRole('button', { name: /agregar dirección/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Agregar dirección' }))
    expect(mut.guardar).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('calle es obligatoria')

    fireEvent.change(screen.getByLabelText(/calle y número/i), { target: { value: 'Calle 1' } })
    fireEvent.change(screen.getByLabelText(/país/i), { target: { value: 'ARG' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar dirección' }))
    expect(mut.guardar).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('dos letras')
  })
})

describe('EditorDirecciones · desactivar en vez de borrar', () => {
  it('Desactivar manda el guardado con activo en falso', () => {
    montar([direccion()])
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar' }))
    const arg = llamada()
    expect(arg.id).toBe('d1')
    expect(arg.datos.activo).toBe(false)
  })

  it('una dirección desactivada se ve marcada y se puede reactivar', () => {
    montar([direccion({ activo: false, esPrincipal: false })])
    expect(screen.getByText('Desactivada')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar' }))
    expect(llamada().datos.activo).toBe(true)
  })

  it('si figura en un pedido, el diálogo pasa a ofrecer desactivarla', () => {
    estado.borrarError = new FalloDeAgenda('DIRECCION_REFERENCIADA', 'Figura en pedidos.')
    montar([direccion()])
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }))

    const dialogo = screen.getByRole('alertdialog')
    expect(within(dialogo).getByText(/no se puede borrar/i)).toBeInTheDocument()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Desactivarla' }))

    expect(mut.borrar).not.toHaveBeenCalled()
    expect(llamada().datos.activo).toBe(false)
  })
})

describe('EditorDirecciones · conflictos y permisos', () => {
  it('un conflicto ofrece recargar y conserva lo escrito', () => {
    estado.guardarError = new FalloDeAgenda('CONFLICTO_DE_EDICION', 'Alguien más la guardó.')
    montar([direccion()])
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    const alerta = screen.getByRole('alert')
    expect(within(alerta).getByRole('button', { name: 'Recargar' })).toBeInTheDocument()
    expect(screen.getByLabelText(/calle y número/i)).toHaveValue('Av. Siempreviva 742')
  })

  it('quien no administra la agenda las lee pero no las toca', () => {
    montar([direccion()], false)
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /agregar dirección/i })).not.toBeInTheDocument()
    expect(screen.getByText(/Av. Siempreviva 742/)).toBeInTheDocument()
  })
})
