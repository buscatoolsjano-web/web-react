// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TablaLineas } from './TablaLineas'
import type { LineaDocumento } from '../types'

const base: LineaDocumento = {
  id: 'l1',
  numeroLinea: 1,
  tipoLinea: 'item',
  productId: 'p1',
  sku: 'PRO12586',
  nombre: 'Balanceador 5 kg',
  descripcion: null,
  cantidad: 2,
  precioUnitario: null,
  descuentoPct: null,
  tratamientoImpuesto: null,
  tasaImpuesto: null,
  ordenLineaId: null,
}

describe('<TablaLineas>', () => {
  it('con precios muestra las columnas de importe y calcula el subtotal', () => {
    render(
      <TablaLineas
        lineas={[{ ...base, precioUnitario: 100, descuentoPct: 10 }]}
        moneda="USD"
        tipo="cotizacion"
      />,
    )
    expect(screen.getByText('Precio')).toBeInTheDocument()
    // 100 × 2 − 10 % = 180
    expect(screen.getByText('USD 180,00')).toBeInTheDocument()
  })

  it('una entrega histórica sin precios oculta las columnas y explica por qué', () => {
    render(<TablaLineas lineas={[base]} moneda="USD" tipo="entrega" />)

    expect(screen.queryByText('Precio')).not.toBeInTheDocument()
    expect(screen.queryByText('Subtotal')).not.toBeInTheDocument()
    expect(screen.getByText(/No se reparte el total entre las líneas/i)).toBeInTheDocument()
    // La cantidad sí está: eso el legacy sí lo guardó.
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('un capítulo ocupa la fila entera y no lleva cantidad', () => {
    render(
      <TablaLineas
        lineas={[{ ...base, id: 'c1', tipoLinea: 'chapter', nombre: 'Accesorios', cantidad: 0 }]}
        moneda="USD"
        tipo="cotizacion"
      />,
    )
    const celda = screen.getByText('Accesorios')
    expect(celda).toBeInTheDocument()
    expect(celda.getAttribute('colspan')).toBe('4')
  })

  it('marca el SKU cuyo producto ya no está en el catálogo', () => {
    render(<TablaLineas lineas={[{ ...base, productId: null }]} moneda="USD" tipo="pedido" />)
    expect(
      screen.getByTitle(/el producto no está en el catálogo actual/i),
    ).toBeInTheDocument()
    // Pero el SKU se sigue viendo: es lo que hace legible el documento viejo.
    expect(screen.getByText(/PRO12586/)).toBeInTheDocument()
  })
})
