// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ChipEstado, ChipFactura, ChipRecepcion, ChipRecepcionDoc } from './ChipEstado'
import { Paginador } from './Paginador'

describe('Estados de Compras como Badge (mismas etiquetas)', () => {
  it('pedido, recepción, nota de entrada y factura', () => {
    render(
      <>
        <ChipEstado estado="draft" />
        <ChipEstado estado="confirmed" />
        <ChipEstado estado="cancelled" />
        <ChipRecepcion estado="partially_received" />
        <ChipRecepcionDoc estado="confirmed" />
        <ChipFactura estado="registered" />
      </>,
    )
    for (const t of ['Borrador', 'Confirmado', 'Cancelado', 'Confirmada']) expect(screen.getByText(t)).toBeInTheDocument()
    expect(screen.getByText('Recibido en parte')).toBeInTheDocument()
    expect(screen.getByText(/registrada/i)).toBeInTheDocument()
  })
})

describe('Paginador de Compras sobre Pagination', () => {
  it('convierte página ↔ desplazamiento sin cambiar el contrato y pluraliza', () => {
    const onIr = vi.fn()
    const onTamano = vi.fn()
    render(<Paginador pagina={2} porPagina={25} total={60} onIr={onIr} onTamano={onTamano} sustantivo={{ singular: 'pedido', plural: 'pedidos' }} />)
    expect(screen.getByText('26–50 de 60 pedidos')).toBeInTheDocument()
    expect(screen.getByText('Página 2 de 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(onIr).toHaveBeenCalledWith(3)
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    expect(onIr).toHaveBeenCalledWith(1)
    fireEvent.change(screen.getByLabelText('Por página'), { target: { value: '50' } })
    expect(onTamano).toHaveBeenCalledWith(50)
  })
})
