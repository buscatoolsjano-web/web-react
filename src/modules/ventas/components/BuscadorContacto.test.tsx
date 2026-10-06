// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { BuscadorContacto } from './BuscadorContacto'
import type { OpcionContacto } from '../services/opciones'

/**
 * Elegir el contacto del documento, escribiendo (Fase 40).
 *
 * Antes era un `<select>`. Con dos o tres daba igual; el cliente más poblado
 * del maestro tiene 22 contactos, y veintidós nombres en un desplegable se
 * recorren a ciegas.
 *
 * Lo que se prueba es lo que el `<select>` no podía hacer: filtrar, buscar por
 * algo que no sea el nombre, y mostrar lo que distingue a dos homónimos.
 */
const contacto = (p: Partial<OpcionContacto> & { id: string; nombre: string }): OpcionContacto => ({
  rol: null,
  esPrincipal: false,
  activo: true,
  email: null,
  telefono: null,
  ...p,
})

const CONTACTOS: OpcionContacto[] = [
  contacto({ id: 'k1', nombre: 'Ana Pérez', rol: 'Compras', esPrincipal: true, email: 'ana@acme.com', telefono: '11 4471-5959' }),
  contacto({ id: 'k2', nombre: 'Juan Gómez', rol: 'Ingeniería', email: 'juan@acme.com' }),
  contacto({ id: 'k3', nombre: 'Juan Rodríguez', rol: 'Pagos', email: 'jrodriguez@acme.com' }),
  contacto({ id: 'k4', nombre: 'Viejo Contacto', activo: false }),
]

function montar(valor = '', contactos: OpcionContacto[] = CONTACTOS) {
  const onElegir = vi.fn()
  render(<BuscadorContacto contactos={contactos} valor={valor} onElegir={onElegir} />)
  return { onElegir }
}

const abrir = () => fireEvent.click(screen.getByRole('button', { name: /contacto/i }))
const escribir = (texto: string) =>
  fireEvent.change(screen.getByRole('searchbox', { name: /buscar contacto/i }), { target: { value: texto } })
const opciones = () =>
  screen.queryAllByRole('option').map((o) => o.textContent?.trim() ?? '')

describe('El buscador de contactos', () => {
  it('cerrado dice cuál está elegido, con su cargo', () => {
    montar('k1')
    expect(screen.getByRole('button', { name: /^Contacto: Ana Pérez/ })).toHaveTextContent('Ana Pérez · Compras')
    // Cerrado no hay lista: es un campo del formulario, no un panel abierto.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('sin contacto lo dice, y no parece el nombre de alguien', () => {
    montar('')
    expect(screen.getByRole('button', { name: 'Elegir contacto' })).toHaveTextContent('Sin contacto')
  })

  it('filtra por nombre a medida que se escribe', () => {
    montar()
    abrir()
    escribir('juan')
    const vistos = opciones().join(' ')
    expect(vistos).toContain('Juan Gómez')
    expect(vistos).toContain('Juan Rodríguez')
    expect(vistos).not.toContain('Ana Pérez')
  })

  /**
   * Muchas veces lo que uno recuerda es el mail y no el apellido. El `<select>`
   * sólo se podía recorrer por el texto visible.
   */
  it('también por email, por cargo y por teléfono', () => {
    montar()
    abrir()
    escribir('jrodriguez')
    expect(opciones().join(' ')).toContain('Juan Rodríguez')

    escribir('pagos')
    expect(opciones().join(' ')).toContain('Juan Rodríguez')

    // El teléfono por dígitos: nadie se acuerda de si lo cargaron con guiones.
    escribir('44715959')
    expect(opciones().join(' ')).toContain('Ana Pérez')
  })

  it('las tildes no hacen falta: «perez» encuentra «Pérez»', () => {
    montar()
    abrir()
    escribir('perez')
    expect(opciones().join(' ')).toContain('Ana Pérez')
  })

  /** Lo que distingue a dos personas con el mismo nombre de pila. */
  it('cada opción muestra el cargo y el email', () => {
    montar()
    abrir()
    escribir('juan')
    expect(screen.getByRole('option', { name: /Juan Gómez/ })).toHaveTextContent('Ingeniería · juan@acme.com')
  })

  it('al elegir avisa el id y cierra', () => {
    const { onElegir } = montar()
    abrir()
    escribir('ana')
    fireEvent.click(screen.getByRole('option', { name: /Ana Pérez/ }))
    expect(onElegir).toHaveBeenCalledWith('k1')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('«Sin contacto» está siempre primero y limpia el campo', () => {
    const { onElegir } = montar('k1')
    abrir()
    expect(opciones()[0]).toBe('Sin contacto')
    fireEvent.click(screen.getByRole('option', { name: 'Sin contacto' }))
    expect(onElegir).toHaveBeenCalledWith('')
  })

  /**
   * Un contacto desactivado no se ofrece… salvo que el documento ya lo nombre.
   * Esconderlo dejaría el campo en blanco y guardar borraría el dato sin que
   * nadie lo pidiera.
   */
  describe('los desactivados', () => {
    it('no se ofrecen', () => {
      montar()
      abrir()
      expect(opciones().join(' ')).not.toContain('Viejo Contacto')
    })

    it('pero si el documento ya lo nombra, se muestra y se dice', () => {
      montar('k4')
      expect(screen.getByRole('button', { name: /^Contacto: Viejo Contacto/ })).toHaveTextContent('desactivado')
      abrir()
      expect(opciones().join(' ')).toContain('Viejo Contacto')
    })
  })

  it('sin contactos cargados lo dice, en vez de una lista vacía', () => {
    montar('', [])
    abrir()
    expect(screen.getByText(/todavía no tiene contactos cargados/i)).toBeInTheDocument()
  })

  it('cuando nada coincide, lo dice', () => {
    montar()
    abrir()
    escribir('zzzz')
    expect(screen.getByText('Ningún contacto coincide.')).toBeInTheDocument()
  })
})
