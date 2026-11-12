// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { PedidoCompraListado } from '../types'

vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => false, useMediaQuery: () => true }))

const { ListadoPedidos } = await import('./ListadoPedidos')
const base: PedidoCompraListado = {
  id: 'p1',
  numero: 'PC00002',
  fecha: '2026-11-12',
  proveedorId: 's1',
  proveedor: 'TECNA',
  moneda: 'EUR',
  total: 0,
  estado: 'draft',
  estadoRecepcion: 'pending',
  fechaEstimada: null,
  autor: 'Jano',
  lineas: 1,
}

function pintar(filas: PedidoCompraListado[], onSeleccionar = vi.fn()) {
  render(
    <MemoryRouter>
      <ListadoPedidos
        filas={filas}
        orden="fecha"
        direccion="desc"
        onOrdenar={vi.fn()}
        cargando={false}
        seleccionados={new Set()}
        onSeleccionar={onSeleccionar}
        onSeleccionarTodos={vi.fn()}
      />
    </MemoryRouter>,
  )
}

describe('ListadoPedidos (mismo formato que los pedidos de venta)', () => {
  it('un solo chip: el borrador dice «Borrador», no «Borrador» + «Sin recibir»', () => {
    pintar([base])
    const fila = screen.getByRole('row', { name: /PC00002/ })
    expect(within(fila).getByText('Borrador')).toBeTruthy()
    expect(within(fila).queryByText('Sin recibir')).toBeNull()
  })

  it('confirmado manda el avance de recepción', () => {
    pintar([
      { ...base, id: 'a', numero: 'PC1', estado: 'confirmed', estadoRecepcion: 'pending' },
      { ...base, id: 'b', numero: 'PC2', estado: 'confirmed', estadoRecepcion: 'received' },
    ])
    expect(within(screen.getByRole('row', { name: /PC1/ })).getByText('Sin recibir')).toBeTruthy()
    const recibido = screen.getByRole('row', { name: /PC2/ })
    expect(within(recibido).getByText('Recibido')).toBeTruthy()
    expect(within(recibido).queryByText('Confirmado')).toBeNull()
  })

  it('columnas en el orden de ventas y casillas para seleccionar', () => {
    const onSeleccionar = vi.fn()
    pintar([base], onSeleccionar)
    const cabeceras = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim())
    expect(cabeceras.slice(1, 6)).toEqual(['Número', 'Proveedor', 'Fecha', 'Total', 'Estado'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar PC00002' }))
    expect(onSeleccionar).toHaveBeenCalledWith('p1', true)
  })
})
