// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Pagination } from './Pagination'
import { contar, rangoTexto } from './rango'

const EVENTOS = { singular: 'evento', plural: 'eventos' }
const PEDIDOS = { singular: 'pedido', plural: 'pedidos' }

describe('rango y pluralización', () => {
  it('singular sólo con 1 (corrige «1–1 de 1 eventos»)', () => {
    expect(rangoTexto(0, 50, 1, EVENTOS)).toBe('1–1 de 1 evento')
    expect(rangoTexto(0, 50, 2, EVENTOS)).toBe('1–2 de 2 eventos')
    expect(contar(0, EVENTOS)).toBe('0 eventos')
    expect(rangoTexto(0, 50, 0, EVENTOS)).toBe('0 eventos')
  })

  it('miles con formato es-AR y última página parcial', () => {
    expect(rangoTexto(0, 50, 1234, PEDIDOS)).toBe('1–50 de 1.234 pedidos')
    expect(rangoTexto(1200, 50, 1234, PEDIDOS)).toBe('1.201–1.234 de 1.234 pedidos')
  })

  it('offset fuera de rango no muestra números imposibles', () => {
    expect(rangoTexto(5000, 50, 1234, PEDIDOS)).toBe('1.234–1.234 de 1.234 pedidos')
  })
})

describe('Pagination', () => {
  it('navega por desplazamiento y deshabilita en los bordes', () => {
    const onChange = vi.fn()
    const { rerender } = render(<Pagination offset={0} pageSize={50} total={120} noun={PEDIDOS} onChange={onChange} />)
    expect(screen.getByRole('navigation', { name: 'Paginación' })).toHaveTextContent('1–50 de 120 pedidos')
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(onChange).toHaveBeenLastCalledWith(50)

    rerender(<Pagination offset={100} pageSize={50} total={120} noun={PEDIDOS} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    expect(onChange).toHaveBeenLastCalledWith(50)
  })

  it('una sola página: sólo el rango, sin botones', () => {
    render(<Pagination offset={0} pageSize={50} total={1} noun={EVENTOS} onChange={() => undefined} />)
    expect(screen.getByText('1–1 de 1 evento')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('cargando deshabilita los dos botones', () => {
    render(<Pagination offset={50} pageSize={50} total={200} noun={PEDIDOS} onChange={() => undefined} loading />)
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
  })
})
