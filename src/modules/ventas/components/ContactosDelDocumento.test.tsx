// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ContactosDelDocumento } from './ContactosDelDocumento'
import type { OpcionContacto } from '../services/opciones'

/**
 * El equipo del cliente que sigue la venta (Fase 40).
 *
 * Lo que se prueba es el contrato con quien guarda: el principal y los
 * secundarios SIEMPRE salen juntos, en una sola llamada. Mandarlos por
 * separado dejaría al documento, entre una y otra, con dos principales o con
 * ninguno — y ese estado intermedio es el que la base rechaza.
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
  contacto({ id: 'k1', nombre: 'Ana Pérez', rol: 'Compras', email: 'ana@acme.com' }),
  contacto({ id: 'k2', nombre: 'Juan Gómez', rol: 'Ingeniería' }),
  contacto({ id: 'k3', nombre: 'Luz Díaz', rol: 'Pagos' }),
]

function montar(principal = '', secundarios: string[] = []) {
  const onCambiar = vi.fn()
  render(
    <ContactosDelDocumento
      contactos={CONTACTOS}
      principal={principal}
      secundarios={secundarios}
      onCambiar={onCambiar}
    />,
  )
  return { onCambiar }
}

const agregar = (nombre: RegExp) => {
  fireEvent.click(screen.getByRole('button', { name: 'Agregar contacto' }))
  fireEvent.click(screen.getByRole('option', { name: nombre }))
}

describe('Los contactos del documento', () => {
  it('sin ninguno lo dice, y no deja la cabecera en blanco sin explicación', () => {
    montar()
    expect(screen.getByText(/Sin contactos/)).toBeInTheDocument()
  })

  /**
   * El primero que entra es el principal: un documento con acompañantes y sin
   * principal es una cabecera que se imprime sin contacto, y nadie lo quiso
   * así.
   */
  it('el primero que se agrega queda como principal', () => {
    const { onCambiar } = montar()
    agregar(/Ana Pérez/)
    expect(onCambiar).toHaveBeenCalledWith('k1', [])
  })

  it('los siguientes se suman como acompañantes, en orden', () => {
    const { onCambiar } = montar('k1', ['k2'])
    agregar(/Luz Díaz/)
    expect(onCambiar).toHaveBeenCalledWith('k1', ['k2', 'k3'])
  })

  it('el que ya está no se vuelve a ofrecer', () => {
    montar('k1', ['k2'])
    fireEvent.click(screen.getByRole('button', { name: 'Agregar contacto' }))
    expect(screen.queryByRole('option', { name: /Ana Pérez/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Juan Gómez/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Luz Díaz/ })).toBeInTheDocument()
  })

  /**
   * La operación que más se repite: «ahora lo lleva Juan». Un clic, y el que
   * estaba baja a acompañante en la misma llamada.
   */
  it('hacer principal es un intercambio, no dos pasos', () => {
    const { onCambiar } = montar('k1', ['k2', 'k3'])
    fireEvent.click(screen.getByRole('button', { name: 'Hacer principal a Juan Gómez' }))
    expect(onCambiar).toHaveBeenCalledTimes(1)
    expect(onCambiar).toHaveBeenCalledWith('k2', ['k3', 'k1'])
  })

  it('el principal se marca, y su estrella no se puede volver a tocar', () => {
    montar('k1', ['k2'])
    expect(screen.getByText('Principal')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ana Pérez es el principal' })).toBeDisabled()
  })

  it('quitar a un acompañante deja al principal donde estaba', () => {
    const { onCambiar } = montar('k1', ['k2', 'k3'])
    fireEvent.click(screen.getByRole('button', { name: 'Quitar a Juan Gómez del documento' }))
    expect(onCambiar).toHaveBeenCalledWith('k1', ['k3'])
  })

  /**
   * Al sacar al principal, el primer acompañante ocupa su lugar. Dejar el
   * documento con acompañantes y sin principal sería dejarlo peor de como
   * estaba.
   */
  it('quitar al principal asciende al primero que lo acompañaba', () => {
    const { onCambiar } = montar('k1', ['k2', 'k3'])
    fireEvent.click(screen.getByRole('button', { name: 'Quitar a Ana Pérez del documento' }))
    expect(onCambiar).toHaveBeenCalledWith('k2', ['k3'])
  })

  it('quitar al único deja el documento sin contactos', () => {
    const { onCambiar } = montar('k1', [])
    fireEvent.click(screen.getByRole('button', { name: 'Quitar a Ana Pérez del documento' }))
    expect(onCambiar).toHaveBeenCalledWith('', [])
  })

  /** El cargo y el email: lo que distingue a dos personas con el mismo nombre. */
  it('cada uno se muestra con su cargo', () => {
    montar('k1', ['k2'])
    expect(screen.getByText('Compras · ana@acme.com')).toBeInTheDocument()
    expect(screen.getByText('Ingeniería')).toBeInTheDocument()
  })
})
