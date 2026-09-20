// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { cleanup, render, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { useVolverAlListado } from './useVolverAlListado'
import type { TipoDocumento } from '../types'

/**
 * Volver al listado como estaba (Fase 19 · E2).
 *
 * Antes el detalle volvía a una ruta fija, así que filtrar, ir a la página 4,
 * abrir un documento y volver dejaba en la página 1 sin filtros — y el «atrás»
 * del navegador, que sí los conserva, quedaba mejor que el botón de la pantalla.
 */
function Sonda({ tipo, etiqueta }: { tipo: TipoDocumento; etiqueta: string }) {
  const volver = useVolverAlListado(tipo, etiqueta)
  return (
    <a href={volver.to} data-testid="volver">
      {volver.label}
    </a>
  )
}

const montar = (tipo: TipoDocumento, etiqueta: string, state?: unknown) => {
  const router = createMemoryRouter(
    [{ path: '/x', element: <Sonda tipo={tipo} etiqueta={etiqueta} /> }],
    { initialEntries: [{ pathname: '/x', state }] },
  )
  // Se desmonta lo anterior y se consulta dentro del contenedor de ESTE
  // render: un mismo test monta varias veces y las consultas globales los
  // verían a todos.
  cleanup()
  const { container } = render(<RouterProvider router={router} />)
  return within(container).getByTestId('volver')
}

describe('useVolverAlListado', () => {
  it('sin estado vuelve al listado pelado: quien llegó por un link nunca estuvo en uno', () => {
    const a = montar('cotizacion', 'Cotizaciones')
    expect(a).toHaveAttribute('href', '/ventas/cotizaciones')
    expect(a).toHaveTextContent('Cotizaciones')
  })

  it('con el listado guardado, vuelve con filtros, página y orden', () => {
    const a = montar('pedido', 'Pedidos', { volverA: '?pendiente=1&page=2&orden=total&dir=asc' })
    expect(a).toHaveAttribute('href', '/ventas/pedidos?pendiente=1&page=2&orden=total&dir=asc')
  })

  it('cada tipo vuelve a SU listado', () => {
    expect(montar('entrega', 'Notas de entrega', { volverA: '?serie=RT-ML' })).toHaveAttribute(
      'href',
      '/ventas/entregas?serie=RT-ML',
    )
  })

  /**
   * El `state` lo controla quien navega, así que no se arma un destino con
   * cualquier cosa: si no parece un query string, se ignora.
   */
  it('un estado que no es un query string se ignora en vez de armar una ruta rara', () => {
    for (const basura of ['/otro/lado', 'https://ajeno.test', '', 'sin-interrogante', 42, null]) {
      const a = montar('cotizacion', 'Cotizaciones', { volverA: basura })
      expect(a).toHaveAttribute('href', '/ventas/cotizaciones')
    }
  })

  it('un estado sin la clave esperada tampoco rompe', () => {
    expect(montar('pedido', 'Pedidos', { otraCosa: 1 })).toHaveAttribute('href', '/ventas/pedidos')
  })
})
