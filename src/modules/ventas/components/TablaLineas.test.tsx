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
    // Sin precios las columnas son #, Referencia, Producto, Descripción y Cant.
    expect(celda.getAttribute('colspan')).toBe('5')
  })

  it('Producto y Descripción son columnas distintas, y el impuesto tiene la suya', () => {
    render(
      <TablaLineas
        lineas={[
          {
            ...base,
            precioUnitario: 100,
            descripcion: 'Con contrapesos de acero',
            tratamientoImpuesto: 'vat_105',
            tasaImpuesto: 10.5,
          },
        ]}
        moneda="USD"
        tipo="cotizacion"
      />,
    )
    expect(screen.getByRole('columnheader', { name: 'Producto' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Descripción' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Impuesto' })).toBeInTheDocument()
    // El tratamiento se nombra, no se muestra la alícuota suelta: «Exento» y
    // «No gravado» son los dos 0 % y no significan lo mismo.
    expect(screen.getByText('IVA 10,5 %')).toBeInTheDocument()
  })

  it('cada celda lleva su rótulo, que es lo que la vuelve tarjeta en mobile', () => {
    const { container } = render(
      <TablaLineas lineas={[{ ...base, precioUnitario: 100 }]} moneda="USD" tipo="cotizacion" />,
    )
    const rotulos = [...container.querySelectorAll('tbody td')].map((td) => td.getAttribute('data-label'))
    expect(rotulos).toEqual(['#', 'Referencia', 'Producto', 'Descripción', 'Cant.', 'Precio', '% Dto.', 'Impuesto', 'Subtotal'])
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
