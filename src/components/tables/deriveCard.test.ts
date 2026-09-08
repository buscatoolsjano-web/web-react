import { describe, it, expect } from 'vitest'
import { deriveCard, resolveCell } from './deriveCard'
import type { Column } from './types'

interface Pedido {
  numero: string
  cliente: string
  total: number
  vendedor: string
  notas: string | null
}

const fila: Pedido = {
  numero: 'PEDIDO #1524',
  cliente: 'Nordex',
  total: 8450,
  vendedor: 'JANO',
  notas: null,
}

const columnas: Column<Pedido>[] = [
  { key: 'numero', header: 'N°', mobile: 'title' },
  { key: 'cliente', header: 'Cliente' },
  { key: 'total', header: 'Total', render: (p) => `USD ${p.total.toLocaleString('es-AR')}` },
  { key: 'vendedor', header: 'Vendedor', mobile: 'hide' },
  { key: 'notas', header: 'Notas' },
]

describe('resolveCell', () => {
  it('usa render cuando está definido', () => {
    expect(resolveCell(columnas[2]!, fila)).toBe('USD 8.450')
  })

  it('cae al valor crudo cuando no hay render', () => {
    expect(resolveCell(columnas[1]!, fila)).toBe('Nordex')
  })

  it('muestra — para null, undefined y string vacío', () => {
    expect(resolveCell(columnas[4]!, fila)).toBe('—')
    expect(resolveCell({ key: 'x', header: 'X' }, {} as Pedido)).toBe('—')
    expect(resolveCell(columnas[1]!, { ...fila, cliente: '' })).toBe('—')
  })
})

describe('deriveCard', () => {
  it('usa la columna marcada como title', () => {
    expect(deriveCard(columnas, fila).title).toBe('PEDIDO #1524')
  })

  it('excluye del cuerpo la columna usada como título', () => {
    const { fields } = deriveCard(columnas, fila)
    expect(fields.map((f) => f.key)).not.toContain('numero')
  })

  it('omite las columnas marcadas como hide', () => {
    const { fields } = deriveCard(columnas, fila)
    expect(fields.map((f) => f.key)).not.toContain('vendedor')
  })

  it('conserva el orden de las columnas restantes', () => {
    const { fields } = deriveCard(columnas, fila)
    expect(fields.map((f) => f.key)).toEqual(['cliente', 'total', 'notas'])
  })

  it('aplica render también dentro de la card', () => {
    const { fields } = deriveCard(columnas, fila)
    expect(fields.find((f) => f.key === 'total')?.value).toBe('USD 8.450')
  })

  it('usa la primera columna visible como título si ninguna es title', () => {
    const sinTitulo: Column<Pedido>[] = [
      { key: 'vendedor', header: 'Vendedor', mobile: 'hide' },
      { key: 'cliente', header: 'Cliente' },
      { key: 'total', header: 'Total' },
    ]
    const card = deriveCard(sinTitulo, fila)
    expect(card.title).toBe('Nordex')
    expect(card.fields.map((f) => f.key)).toEqual(['total'])
  })

  it('no rompe con una lista de columnas vacía', () => {
    expect(deriveCard([], fila)).toEqual({ title: null, fields: [] })
  })
})
