// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { EditorLineas } from './EditorLineas'
import type { LineaDocumento } from '../types'

const linea = (p: Partial<LineaDocumento> = {}): LineaDocumento => ({
  id: 'l1',
  numeroLinea: 1,
  tipoLinea: 'item',
  productId: null,
  sku: 'LIBRE',
  nombre: 'Servicio',
  descripcion: null,
  cantidad: 2,
  precioUnitario: 50,
  descuentoPct: 10,
  tratamientoImpuesto: 'vat_21',
  tasaImpuesto: 21,
  ordenLineaId: null,
  ...p,
})

function montar(lineas: LineaDocumento[], editable = true) {
  const onCambiar = vi.fn()
  const onEliminar = vi.fn()
  const onMover = vi.fn()
  render(
    <EditorLineas
      lineas={lineas}
      moneda="USD"
      editable={editable}
      onCambiar={onCambiar}
      onEliminar={onEliminar}
      onMover={onMover}
    />,
  )
  return { onCambiar, onEliminar, onMover }
}

describe('<EditorLineas>', () => {
  it('guarda al salir del campo, y sólo si el valor cambió', () => {
    const { onCambiar } = montar([linea()])
    const cantidad = screen.getByLabelText('Cantidad')

    // Sale sin tocar nada: no se guarda.
    fireEvent.blur(cantidad)
    expect(onCambiar).not.toHaveBeenCalled()

    fireEvent.change(cantidad, { target: { value: '5' } })
    fireEvent.blur(cantidad)
    expect(onCambiar).toHaveBeenCalledExactlyOnceWith('l1', 'quantity', 5)
  })

  it('muestra el neto de la línea con su descuento', () => {
    montar([linea()])
    // 2 × 50 − 10 % = 90
    expect(screen.getByText('USD 90,00')).toBeInTheDocument()
  })

  it('un capítulo ocupa la fila y no tiene cantidad ni precio', () => {
    montar([linea({ tipoLinea: 'chapter', nombre: 'Accesorios' })])
    expect(screen.getByLabelText('Título del capítulo')).toHaveValue('Accesorios')
    expect(screen.queryByLabelText('Cantidad')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Precio unitario')).not.toBeInTheDocument()
  })

  it('el SKU de un producto del catálogo no se puede editar', () => {
    montar([linea({ productId: 'p1', sku: 'PRO05229' })])
    expect(screen.getByLabelText('Referencia')).toHaveAttribute('readonly')
  })

  it('una línea libre sí deja editar el SKU', () => {
    montar([linea({ productId: null })])
    expect(screen.getByLabelText('Referencia')).not.toHaveAttribute('readonly')
  })

  it('«otra alícuota» muestra el campo para escribirla', () => {
    montar([linea({ tratamientoImpuesto: 'other', tasaImpuesto: 5 })])
    expect(screen.getByLabelText('Alícuota')).toHaveValue(5)
  })

  it('en sólo lectura no hay botones de mover ni borrar', () => {
    montar([linea()], false)
    expect(screen.queryByLabelText('Eliminar línea')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Cantidad')).toHaveAttribute('readonly')
  })

  it('mover usa el id de la línea, no su posición', () => {
    const { onMover } = montar([linea({ id: 'a' }), linea({ id: 'b', numeroLinea: 2 })])
    fireEvent.click(screen.getAllByLabelText('Bajar')[0]!)
    expect(onMover).toHaveBeenCalledExactlyOnceWith('a', 1)
  })

  it('la primera no puede subir y la última no puede bajar', () => {
    montar([linea({ id: 'a' }), linea({ id: 'b', numeroLinea: 2 })])
    expect(screen.getAllByLabelText('Subir')[0]).toBeDisabled()
    expect(screen.getAllByLabelText('Bajar')[1]).toBeDisabled()
  })

  it('sin líneas lo dice en vez de mostrar una tabla vacía', () => {
    montar([])
    expect(screen.getByText('Todavía no hay líneas.')).toBeInTheDocument()
  })
})
