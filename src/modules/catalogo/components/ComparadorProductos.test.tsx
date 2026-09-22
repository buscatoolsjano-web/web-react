// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ComparadorProductos } from './ComparadorProductos'
import type { ProductoListado } from '../types'

/**
 * El comparador (Fase 22 · cierre).
 *
 * Lo que se prueba es la ORIENTACIÓN y el veredicto por celda. La orientación
 * no es estética: uno compara leyendo una fila —«¿qué recorrido tiene cada
 * uno?»— y con los productos en filas esa pregunta obliga a saltar de columna
 * en columna. Si alguien la transpone de vuelta, estos tests caen.
 */
const producto = (x: Partial<ProductoListado> & { sku: string }): ProductoListado => ({
  enCatalogo: true,
  id: x.sku,
  nombre: x.sku,
  serie: null,
  tipo: null,
  esKit: false,
  necesitaRevision: false,
  marca: null,
  categoria: null,
  atributos: {},
  precio: null,
  stock: null,
  disponible: null,
  imagen: null,
  ...x,
})

const balanceador = (sku: string, marca: string, a: Record<string, unknown>) =>
  producto({ sku, marca: { id: marca, nombre: marca }, atributos: a, categoria: { id: 'c', nombre: 'Balanceadores', slug: 'balanceador' } })

const PRINCIPAL = balanceador('TE.9323', 'TECNA', { min_kg: 6, max_kg: 8, longitud: '2', carcasa: 'ALUMINIO' })
const IGUAL = balanceador('TE.9323NY', 'TECNA', { min_kg: 6, max_kg: 8, longitud: '2', carcasa: 'ALUMINIO' })
const OTRA_CARCASA = balanceador('TE.9323IL', 'TECNA', { min_kg: 6, max_kg: 8, longitud: '2', carcasa: 'INOXIDABLE' })
const OTRO_RECORRIDO = balanceador('TE.9338', 'TECNA', { min_kg: 6, max_kg: 8, longitud: '2.5', carcasa: 'ALUMINIO' })
const SIN_CARCASA = balanceador('TE.9999', 'TECNA', { min_kg: 6, max_kg: 8, longitud: '2' })

const montar = (props: Partial<Parameters<typeof ComparadorProductos>[0]> = {}) =>
  render(
    <ComparadorProductos
      principal={PRINCIPAL}
      similares={[IGUAL, OTRA_CARCASA, OTRO_RECORRIDO]}
      familia="balanceador"
      moneda="USD"
      onAbrirProducto={vi.fn()}
      variante="compacta"
      {...props}
    />,
  )

/** La fila cuyo encabezado es ese atributo. */
const fila = (etiqueta: string) => screen.getByRole('rowheader', { name: etiqueta }).closest('tr')!
const celdas = (etiqueta: string) => within(fila(etiqueta)).getAllByRole('cell')

describe('Atributos en filas, productos en columnas', () => {
  it('cada atributo de la familia es UNA fila', () => {
    montar()
    for (const e of ['Marca', 'Modelo', 'Capacidad mínima', 'Capacidad máxima', 'Recorrido', 'Carcasa']) {
      expect(screen.getByRole('rowheader', { name: e })).toBeInTheDocument()
    }
  })

  it('cada producto es UNA columna, y hay una por producto', () => {
    montar()
    // Principal + 3 similares.
    expect(screen.getAllByRole('columnheader')).toHaveLength(4)
  })

  it('el encabezado de columna lleva marca y modelo', () => {
    montar()
    const cab = screen.getAllByRole('columnheader')[1]!
    expect(cab).toHaveTextContent('TECNA')
    expect(cab).toHaveTextContent('TE.9323NY')
  })

  it('una fila lee el mismo atributo de todos: eso es comparar', () => {
    montar()
    expect(celdas('Carcasa').map((c) => c.textContent)).toEqual([
      expect.stringContaining('ALUMINIO'),
      expect.stringContaining('ALUMINIO'),
      expect.stringContaining('INOXIDABLE'),
      expect.stringContaining('ALUMINIO'),
    ])
  })
})

describe('El principal es la línea base (§2)', () => {
  it('va primero y se identifica', () => {
    montar()
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('Estás viendo')
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('TE.9323')
  })

  it('su columna NO se pinta contra sí misma', () => {
    montar()
    for (const e of ['Carcasa', 'Recorrido', 'Capacidad mínima']) {
      expect(celdas(e)[0]).not.toHaveAttribute('data-veredicto')
    }
  })
})

describe('Verde, rojo y neutro por celda (§3)', () => {
  it('mismo valor → igual', () => {
    montar()
    expect(celdas('Carcasa')[1]).toHaveAttribute('data-veredicto', 'igual')
  })

  it('valor distinto → distinto', () => {
    montar()
    expect(celdas('Carcasa')[2]).toHaveAttribute('data-veredicto', 'distinto')
    expect(celdas('Recorrido')[3]).toHaveAttribute('data-veredicto', 'distinto')
  })

  it('si a alguno le falta el dato → sin-dato, nunca rojo', () => {
    montar({ similares: [SIN_CARCASA] })
    expect(celdas('Carcasa')[1]).toHaveAttribute('data-veredicto', 'sin-dato')
  })

  it('el modelo identifica y no se compara: dos productos distintos siempre difieren', () => {
    montar()
    expect(celdas('Modelo')[1]).toHaveAttribute('data-veredicto', 'sin-dato')
  })

  it('unidades equivalentes coinciden: 2 m y 2000 mm son el mismo recorrido', () => {
    const enMm = balanceador('TE.X', 'TECNA', { min_kg: 6, max_kg: 8, longitud: '2000 mm', carcasa: 'ALUMINIO' })
    montar({ similares: [enMm] })
    expect(celdas('Recorrido')[1]).toHaveAttribute('data-veredicto', 'igual')
  })

  it('el color NO va solo: cada celda comparada lleva su símbolo', () => {
    montar()
    expect(celdas('Carcasa')[1]?.textContent).toContain('=')
    expect(celdas('Carcasa')[2]?.textContent).toContain('≠')
    expect(celdas('Modelo')[1]?.textContent).toContain('?')
  })
})

describe('Ancho (§5)', () => {
  it('compacta muestra el principal y 3 similares como mucho', () => {
    montar({ similares: [IGUAL, OTRA_CARCASA, OTRO_RECORRIDO, SIN_CARCASA, PRINCIPAL] })
    expect(screen.getAllByRole('columnheader')).toHaveLength(4)
  })

  it('completa admite más, porque el modal tiene espacio', () => {
    montar({ variante: 'completa', similares: [IGUAL, OTRA_CARCASA, OTRO_RECORRIDO, SIN_CARCASA] })
    expect(screen.getAllByRole('columnheader')).toHaveLength(5)
  })
})

describe('Equivalencias curadas (§9)', () => {
  const fuentes = new Map<string, 'legacy' | 'calculated'>([
    ['TE.9323IL', 'legacy'],
    ['TE.9338', 'calculated'],
  ])

  it('la curada se marca como equivalente', () => {
    montar({ fuentes })
    expect(screen.getAllByRole('columnheader')[2]).toHaveTextContent('Equivalente')
  })

  it('la calculada no lleva esa marca', () => {
    montar({ fuentes })
    expect(screen.getAllByRole('columnheader')[3]).not.toHaveTextContent('Equivalente')
  })

  it('ser equivalente NO le cambia los colores: sus diferencias se siguen viendo', () => {
    montar({ fuentes })
    // TE.9323IL está curado y aun así su carcasa sale en rojo.
    expect(celdas('Carcasa')[2]).toHaveAttribute('data-veredicto', 'distinto')
  })
})

describe('Familias sin datos', () => {
  it('«Otros» no dibuja un comparador vacío', () => {
    const { container } = montar({ familia: 'otros' })
    expect(container.querySelector('table')).toBeNull()
  })
})
