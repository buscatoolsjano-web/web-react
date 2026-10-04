// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { EditorLineas } from './EditorLineas'
import type { UltimoPrecio } from '@/modules/clientes/types'
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

function montar(
  lineas: LineaDocumento[],
  editable = true,
  historicos?: Map<string, UltimoPrecio>,
) {
  const onCambiar = vi.fn()
  const onEliminar = vi.fn()
  const onMover = vi.fn()
  render(
    <EditorLineas
      lineas={lineas}
      moneda="USD"
      editable={editable}
      historicos={historicos}
      onCambiar={onCambiar}
      onEliminar={onEliminar}
      onMover={onMover}
    />,
  )
  return { onCambiar, onEliminar, onMover }
}

/** El caso real: al mismo cliente, 49,40 y después 22,20 en USD. */
const HISTORICO = (precio = 22.2): Map<string, UltimoPrecio> =>
  new Map([
    [
      'prod-1',
      {
        productId: 'prod-1',
        sku: 'PRO05229',
        nombre: 'Balanceador',
        moneda: 'USD',
        ultimoPrecio: precio,
        ultimaFecha: '2026-05-19',
        ultimoDocumento: 'PDV01233',
        ultimoDocumentoId: 'd1',
        ultimoTipo: 'pedido' as const,
        precioAnterior: 49.4,
        veces: 2,
      },
    ],
  ])

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

  // Fase 28 · E11: una nota es UNA caja de texto y nada más.
  it('una nota ocupa la fila y no tiene cantidad ni precio', () => {
    montar([linea({ tipoLinea: 'chapter', nombre: 'Se entrega en Melincué 5125.' })])
    expect(screen.getByLabelText('Nota del documento')).toHaveValue('Se entrega en Melincué 5125.')
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

/*
 * El último precio de este cliente por este producto (Fase 40).
 *
 * Lo pidió el negocio así: que el precio se complete solo y que, si alguien lo
 * cambia, se vea en naranja cuál era. El aviso tiene que decir el MONTO
 * ANTERIOR, no el que está escrito en la línea: sin el monto no sirve para
 * decidir nada.
 */
describe('<EditorLineas> · último precio del cliente', () => {
  it('cuando el precio no es el de la última vez, lo avisa con el monto', () => {
    montar([linea({ productId: 'prod-1', precioUnitario: 49.4 })], true, HISTORICO())
    const aviso = screen.getByText(/Último precio/)
    expect(aviso.textContent).toMatch(/22[.,]20/)
    expect(aviso.textContent).toContain('PDV01233')
    expect(aviso.textContent).toContain('pedido')
  })

  it('cuando coincide, lo dice sin alarmar', () => {
    montar([linea({ productId: 'prod-1', precioUnitario: 22.2 })], true, HISTORICO())
    expect(screen.getByText(/Es el último precio/)).toBeInTheDocument()
    expect(screen.queryByText(/Último precio:/)).toBeNull()
  })

  it('sin histórico no dice nada: no se inventa un aviso', () => {
    montar([linea({ productId: 'prod-1', precioUnitario: 49.4 })])
    expect(screen.queryByText(/ltimo precio/)).toBeNull()
  })

  it('una línea libre, sin producto, no se compara con nada', () => {
    // El histórico es por producto; una línea escrita a mano no tiene con qué
    // emparejarse, aunque el cliente tenga histórico de otras cosas.
    montar([linea({ productId: null, precioUnitario: 49.4 })], true, HISTORICO())
    expect(screen.queryByText(/ltimo precio/)).toBeNull()
  })

  it('un centavo de diferencia ya avisa', () => {
    montar([linea({ productId: 'prod-1', precioUnitario: 22.21 })], true, HISTORICO())
    expect(screen.getByText(/Último precio:/)).toBeInTheDocument()
  })
})
