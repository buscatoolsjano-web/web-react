// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ActionBar } from './ActionBar'
import { DocSection, MetaList, Missing, Totals } from './DocSection'
import { Alert } from '@/components/feedback/Alert'

const movil = vi.hoisted(() => ({ valor: false }))
vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => movil.valor, useMediaQuery: () => false }))
const { FilterBar } = await import('@/components/filters/FilterBar')

describe('ActionBar', () => {
  it('agrupa primaria, secundarias, peligro y nota en un grupo con nombre; sin nada no renderiza', () => {
    const { container, rerender } = render(
      <ActionBar primary={<button>Confirmar</button>} secondary={<button>Editar</button>} danger={<button>Eliminar</button>} note={<p>Motivo</p>} />,
    )
    const grupo = screen.getByRole('group', { name: 'Acciones del documento' })
    expect(grupo).toHaveTextContent('ConfirmarEditarEliminarMotivo')
    // Nunca fija ni pega la barra sobre el contenido.
    expect(grupo.getAttribute('style')).toBeNull()
    rerender(<ActionBar />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('DocSection, MetaList y Totals', () => {
  it('sección con h2 asociado, datos como lista de definiciones y faltantes visibles', () => {
    render(
      <DocSection title="Datos del pedido">
        <MetaList items={[{ label: 'Cliente', value: 'ZZ SA' }, null, false, { label: 'Vendedor', value: <Missing /> }]} />
      </DocSection>,
    )
    expect(screen.getByRole('region', { name: 'Datos del pedido' })).toBeInTheDocument()
    expect(screen.getAllByRole('term').map((t) => t.textContent)).toEqual(['Cliente', 'Vendedor'])
    expect(screen.getByText('Sin registrar')).toBeInTheDocument()
  })

  it('totales con la fila final destacada y nota', () => {
    render(<Totals rows={[{ label: 'Subtotal', value: 'USD 10,00' }, { label: 'Total', value: 'USD 12,10', strong: true }]} note="Lo calcula el servidor." />)
    expect(screen.getByText('USD 12,10')).toBeInTheDocument()
    expect(screen.getByText('Lo calcula el servidor.')).toBeInTheDocument()
  })
})

describe('Alert', () => {
  it('rol por contexto, título y texto; el ícono es decorativo', () => {
    const { container } = render(
      <Alert tone="danger" role="alert" title="No se pudo guardar">
        <p>Sin conexión.</p>
      </Alert>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardarSin conexión.')
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('FilterBar', () => {
  it('escritorio: todos los filtros visibles y «Limpiar filtros» sólo si hay filtros', () => {
    movil.valor = false
    const onClear = vi.fn()
    const { rerender } = render(
      <FilterBar search={<input aria-label="Buscar" />} onClear={onClear} hasFilters={false}>
        <select aria-label="Estado" />
      </FilterBar>,
    )
    expect(screen.getByRole('search', { name: 'Filtros' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Estado' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull()
    rerender(
      <FilterBar search={<input aria-label="Buscar" />} onClear={onClear} hasFilters>
        <select aria-label="Estado" />
      </FilterBar>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(onClear).toHaveBeenCalled()
  })

  it('mobile: búsqueda a la vista; el resto plegado con contador anunciado', () => {
    movil.valor = true
    render(
      <FilterBar search={<input aria-label="Buscar" />} activeCount={2}>
        <select aria-label="Estado" />
      </FilterBar>,
    )
    const boton = screen.getByRole('button', { name: /^Filtros\s*2\s*aplicados$/ })
    expect(boton).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById(boton.getAttribute('aria-controls')!)).toHaveAttribute('hidden')
    fireEvent.click(boton)
    expect(document.getElementById(boton.getAttribute('aria-controls')!)).not.toHaveAttribute('hidden')
  })
})
