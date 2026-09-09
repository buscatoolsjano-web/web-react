// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PanelPendientes } from './PanelPendientes'
import type { ResultadoPendientes } from '../lib/pendientes'
import type { LineaDocumento } from '../types'

const linea = (id: string, sku: string, cantidad: number): LineaDocumento => ({
  id,
  numeroLinea: 1,
  tipoLinea: 'item',
  productId: null,
  sku,
  nombre: sku,
  descripcion: null,
  cantidad,
  precioUnitario: null,
  descuentoPct: null,
  tratamientoImpuesto: null,
  tasaImpuesto: null,
  ordenLineaId: null,
})

const LINEAS = [linea('a', 'PRO12586', 100)]

/**
 * Lo que se prueba acá no es el cálculo —eso está en pendientes.test.ts— sino
 * que la pantalla NO muestre un número cuando no hay evidencia.
 */
describe('<PanelPendientes>', () => {
  it('muestra pedido, entregado y pendiente cuando hay evidencia', () => {
    const r: ResultadoPendientes = {
      estado: 'RECONSTRUIDO',
      porLinea: [{ lineaId: 'a', pedido: 100, entregado: 70, pendiente: 30, exceso: 0 }],
      lineasSinEnlazar: 0,
      hayExceso: false,
    }
    render(<PanelPendientes lineas={LINEAS} resultado={r} cargando={false} />)

    expect(screen.getByText('Pendiente')).toBeInTheDocument()
    expect(screen.getByText('70')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
  })

  it('NO_CONSTA_ENTREGA no muestra ninguna cantidad, y dice que no es lo mismo que no entregado', () => {
    const r: ResultadoPendientes = {
      estado: 'NO_CONSTA_ENTREGA',
      porLinea: [],
      lineasSinEnlazar: 0,
      hayExceso: false,
    }
    render(<PanelPendientes lineas={LINEAS} resultado={r} cargando={false} />)

    expect(screen.getByText('No consta entrega')).toBeInTheDocument()
    expect(screen.getByText(/no es lo mismo que «no entregado»/i)).toBeInTheDocument()
    // Lo esencial: no hay tabla ni cantidades.
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('100')).not.toBeInTheDocument()
  })

  it('DETALLE_NO_RECONSTRUIDO tampoco muestra cantidades', () => {
    const r: ResultadoPendientes = {
      estado: 'DETALLE_NO_RECONSTRUIDO',
      porLinea: [],
      lineasSinEnlazar: 2,
      hayExceso: false,
    }
    render(<PanelPendientes lineas={LINEAS} resultado={r} cargando={false} />)

    expect(screen.getByText('Entrega histórica no reconstruida')).toBeInTheDocument()
    expect(screen.getByText(/2 líneas de entrega no se pudieron asociar/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('el exceso se muestra como inconsistencia y el pendiente no queda negativo', () => {
    const r: ResultadoPendientes = {
      estado: 'RECONSTRUIDO',
      porLinea: [{ lineaId: 'a', pedido: 1, entregado: 2, pendiente: 0, exceso: 1 }],
      lineasSinEnlazar: 0,
      hayExceso: true,
    }
    render(<PanelPendientes lineas={[linea('a', 'TE.X-LIGHT.1', 1)]} resultado={r} cargando={false} />)

    expect(screen.getByText('Se entregó más de lo pedido')).toBeInTheDocument()
    expect(screen.getByText(/no se corrigieron/i)).toBeInTheDocument()
    expect(screen.getByText('+1 de más')).toBeInTheDocument()
    expect(screen.queryByText('-1')).not.toBeInTheDocument()
  })

  it('mientras carga no afirma nada', () => {
    render(<PanelPendientes lineas={LINEAS} resultado={undefined} cargando={true} />)
    expect(screen.getByText('Calculando entregas…')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
