// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { Column } from './types'

const estado = vi.hoisted(() => ({ movil: false }))
vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => estado.movil, useMediaQuery: () => estado.movil }))

const { ResponsiveTable } = await import('./ResponsiveTable')

interface Fila {
  id: string
  tipo: string
  proximo: string
  autoridad: string
}

const COLUMNAS: Column<Fila>[] = [
  { key: 'tipo', header: 'Tipo', mobile: 'title' },
  { key: 'proximo', header: 'Próximo', hideBelow: 'xl' },
  { key: 'extra', header: 'Extra', hideBelow: 'lg', render: () => 'dato secundario' },
  { key: 'autoridad', header: 'Autoridad' },
]
const FILAS: Fila[] = [{ id: '1', tipo: 'Cotizaciones', proximo: 'QUO00005', autoridad: 'STEL' }]

beforeEach(() => {
  estado.movil = false
})

describe('<ResponsiveTable> con prioridad de columnas', () => {
  it('las secundarias llevan la clase que las oculta por ancho; las esenciales, no', () => {
    render(<ResponsiveTable columns={COLUMNAS} rows={FILAS} rowKey={(f) => f.id} />)
    const [tipo, proximo, extra, autoridad] = screen.getAllByRole('columnheader')
    expect(proximo!.className).toMatch(/ocultaBajoXl/)
    expect(extra!.className).toMatch(/ocultaBajoLg/)
    expect(tipo!.className).not.toMatch(/oculta/)
    // La autoridad (STEL) es esencial: nunca se oculta por ancho.
    expect(autoridad!.className).not.toMatch(/oculta/)
    const celdas = within(screen.getAllByRole('row')[1]!).getAllByRole('cell')
    expect(celdas[1]!.className).toMatch(/ocultaBajoXl/)
    expect(celdas[3]).toHaveTextContent('STEL')
    expect(celdas[3]!.className).not.toMatch(/oculta/)
  })

  it('en mobile la card muestra también las columnas secundarias', () => {
    estado.movil = true
    render(<ResponsiveTable columns={COLUMNAS} rows={FILAS} rowKey={(f) => f.id} />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('QUO00005')).toBeInTheDocument()
    expect(screen.getByText('dato secundario')).toBeInTheDocument()
    expect(screen.getByText('STEL')).toBeInTheDocument()
  })

  it('cargando con skeleton anunciado; vacío con su mensaje', () => {
    const { rerender } = render(<ResponsiveTable columns={COLUMNAS} rows={[]} rowKey={(f) => f.id} isLoading />)
    expect(screen.getByRole('status', { name: 'Cargando…' })).toBeInTheDocument()
    rerender(<ResponsiveTable columns={COLUMNAS} rows={[]} rowKey={(f) => f.id} emptyMessage="Sin secuencias." />)
    expect(screen.getByText('Sin secuencias.')).toBeInTheDocument()
  })
})
