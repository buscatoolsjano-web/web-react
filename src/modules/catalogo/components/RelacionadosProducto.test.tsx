// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RelacionadosProducto } from './RelacionadosProducto'
import type { ProductoListado } from '../types'

/**
 * Paridad con la ficha del legacy (Fase 22 · cierre).
 *
 * El legacy tenía DOS secciones separadas en la ficha del producto:
 *
 *   🔄 Productos similares (equivalencias)  → las cargadas a mano, agrupadas
 *                                             por marca («Similar TECNA», …)
 *   🔗 Productos relacionados               → las calculadas por atributos
 *
 * React las traía en una sola grilla, sin distinguirlas: una equivalencia que
 * alguien verificó se veía igual que un parecido que calculó una fórmula. Acá
 * salen juntas —vienen de una sola consulta— pero la curada lleva su marca.
 */
const producto = (id: string, sku: string): ProductoListado =>
  ({
    id,
    sku,
    nombre: `Producto ${sku}`,
    tipo: 'Balanceador',
    atributos: { medida: '2.0' },
    precio: 100,
    imagen: null,
    marca: null,
    categoria: null,
    serie: null,
    stock: null,
    enCatalogo: true,
  }) as unknown as ProductoListado

const PRODUCTOS = [producto('a', 'TE.9336L'), producto('b', 'IR.BMDS-4')]

describe('Curada y calculada no se ven igual', () => {
  it('la equivalencia del legacy lleva su distintivo', () => {
    render(
      <RelacionadosProducto
        productos={PRODUCTOS}
        cargando={false}
        moneda="USD"
        fuentes={new Map([['a', 'legacy'], ['b', 'calculated']])}
        onAbrir={() => {}}
      />,
    )
    const curada = screen.getByText('TE.9336L').closest('button')!
    expect(within(curada).getByText('Equivalente')).toBeInTheDocument()
  })

  it('la calculada NO lo lleva', () => {
    render(
      <RelacionadosProducto
        productos={PRODUCTOS}
        cargando={false}
        moneda="USD"
        fuentes={new Map([['a', 'legacy'], ['b', 'calculated']])}
        onAbrir={() => {}}
      />,
    )
    const calculada = screen.getByText('IR.BMDS-4').closest('button')!
    expect(within(calculada).queryByText('Equivalente')).toBeNull()
  })

  it('sin el mapa de fuentes no se inventa ninguno', () => {
    // La ficha puede renderizarse antes de que llegue la procedencia. Marcar
    // todo como equivalente mientras tanto sería afirmar algo que no se sabe.
    render(
      <RelacionadosProducto productos={PRODUCTOS} cargando={false} moneda="USD" onAbrir={() => {}} />,
    )
    expect(screen.queryByText('Equivalente')).toBeNull()
  })

  it('el distintivo explica de dónde sale, no sólo qué dice', () => {
    render(
      <RelacionadosProducto
        productos={PRODUCTOS}
        cargando={false}
        moneda="USD"
        fuentes={new Map([['a', 'legacy']])}
        onAbrir={() => {}}
      />,
    )
    expect(screen.getByText('Equivalente')).toHaveAttribute(
      'title',
      'Equivalencia cargada a mano en el catálogo anterior',
    )
  })

  it('el distintivo va DESPUÉS del SKU: lo califica, no lo reemplaza', () => {
    render(
      <RelacionadosProducto
        productos={PRODUCTOS}
        cargando={false}
        moneda="USD"
        fuentes={new Map([['a', 'legacy']])}
        onAbrir={() => {}}
      />,
    )
    expect(screen.getByText('Equivalente').previousElementSibling).toBe(screen.getByText('TE.9336L'))
  })
})
