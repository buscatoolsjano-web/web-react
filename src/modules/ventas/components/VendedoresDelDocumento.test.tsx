// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { VendedoresDelDocumento } from './VendedoresDelDocumento'

/**
 * Quién se lleva esta venta (Fase 40).
 *
 * Pasa seguido que una venta la lleven dos: uno abre la cuenta y otro la
 * sigue. Hasta ahora el documento tenía UN vendedor y el otro no figuraba en
 * ningún lado: ni en los rankings, ni para filtrar, ni para repartir.
 */
const VENDEDORES = [
  { id: 'u1', nombre: 'Ana Vendedora' },
  { id: 'u2', nombre: 'Beto Comercial' },
  { id: 'u3', nombre: 'Caro Técnica' },
]

function montar(principal = '', acompanan: string[] = []) {
  const onCambiar = vi.fn()
  render(
    <VendedoresDelDocumento
      vendedores={VENDEDORES}
      principal={principal}
      acompanan={acompanan}
      onCambiar={onCambiar}
    />,
  )
  return { onCambiar }
}

const agregar = (nombre: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Agregar vendedor' }))
  fireEvent.click(screen.getByRole('option', { name: nombre }))
}

describe('Los vendedores del documento', () => {
  it('sin ninguno lo dice', () => {
    montar()
    expect(screen.getByText('Sin vendedor asignado.')).toBeInTheDocument()
  })

  it('el primero que se agrega queda como principal', () => {
    const { onCambiar } = montar()
    agregar('Beto Comercial')
    expect(onCambiar).toHaveBeenCalledWith('u2', [])
  })

  it('los siguientes acompañan, en orden', () => {
    const { onCambiar } = montar('u1', ['u2'])
    agregar('Caro Técnica')
    expect(onCambiar).toHaveBeenCalledWith('u1', ['u2', 'u3'])
  })

  it('el que ya está no se vuelve a ofrecer', () => {
    montar('u1', ['u2'])
    fireEvent.click(screen.getByRole('button', { name: 'Agregar vendedor' }))
    expect(screen.queryByRole('option', { name: 'Ana Vendedora' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Caro Técnica' })).toBeInTheDocument()
  })

  it('con todos adentro, el botón lo dice y no se puede tocar', () => {
    montar('u1', ['u2', 'u3'])
    const boton = screen.getByRole('button', { name: 'Agregar vendedor' })
    expect(boton).toBeDisabled()
    expect(boton).toHaveTextContent('Ya están todos')
  })

  /** La operación que más se repite: «ahora la lleva Beto». */
  it('hacer principal es un intercambio, en una sola llamada', () => {
    const { onCambiar } = montar('u1', ['u2', 'u3'])
    fireEvent.click(screen.getByRole('button', { name: 'Hacer principal a Beto Comercial' }))
    expect(onCambiar).toHaveBeenCalledTimes(1)
    expect(onCambiar).toHaveBeenCalledWith('u2', ['u3', 'u1'])
  })

  it('el principal se marca y su estrella no se vuelve a tocar', () => {
    montar('u1', ['u2'])
    expect(screen.getByText('Principal')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ana Vendedora es el principal' })).toBeDisabled()
  })

  it('quitar al principal asciende al primero que lo acompañaba', () => {
    const { onCambiar } = montar('u1', ['u2', 'u3'])
    fireEvent.click(screen.getByRole('button', { name: 'Quitar a Ana Vendedora de la venta' }))
    expect(onCambiar).toHaveBeenCalledWith('u2', ['u3'])
  })

  it('sin permiso de edición no hay botones que toquen nada', () => {
    render(
      <VendedoresDelDocumento
        vendedores={VENDEDORES}
        principal="u1"
        acompanan={['u2']}
        disabled
        onCambiar={() => {}}
      />,
    )
    expect(screen.getByText('Ana Vendedora')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
