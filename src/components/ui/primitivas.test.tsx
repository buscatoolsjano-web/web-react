// @vitest-environment jsdom
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Button } from './Button'
import { IconButton } from './IconButton'
import { Badge } from './Badge'
import { Spinner } from './Spinner'
import { SkeletonRows } from './Skeleton'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'

describe('Button', () => {
  it('type=button por defecto, variante primaria, reenvía ref', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>Guardar</Button>)
    const b = screen.getByRole('button', { name: 'Guardar' })
    expect(b).toHaveAttribute('type', 'button')
    expect(ref.current).toBe(b)
  })

  it('compatible con el uso de Fase 1 (variant + block + type submit)', () => {
    render(
      <form>
        <Button variant="secondary" block type="submit">
          Ingresar
        </Button>
      </form>,
    )
    expect(screen.getByRole('button', { name: 'Ingresar' })).toHaveAttribute('type', 'submit')
  })

  it('loading: deshabilitado, aria-busy, conserva el texto y no dispara onClick', () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Guardando
      </Button>,
    )
    const b = screen.getByRole('button', { name: 'Guardando' })
    expect(b).toBeDisabled()
    expect(b).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(b)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('el ícono es decorativo', () => {
    render(<Button icon={<svg data-testid="i" />}>Nuevo pedido</Button>)
    expect(screen.getByTestId('i').parentElement).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button')).toHaveAccessibleName('Nuevo pedido')
  })
})

describe('IconButton, Badge, Spinner, Skeleton', () => {
  it('IconButton se nombra por aria-label y el svg no se lee', () => {
    render(<IconButton icon="trash" aria-label="Eliminar línea" variant="danger" />)
    const b = screen.getByRole('button', { name: 'Eliminar línea' })
    expect(b.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('Badge muestra texto (nunca sólo color) y el punto es decorativo', () => {
    const { container } = render(
      <Badge tone="success" dot>
        Entregado
      </Badge>,
    )
    expect(screen.getByText('Entregado')).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('Spinner: con label es status; sin label es decorativo', () => {
    const { container } = render(
      <>
        <Spinner label="Cargando pedidos" />
        <Spinner />
      </>,
    )
    expect(screen.getByRole('status', { name: 'Cargando pedidos' })).toBeInTheDocument()
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1)
  })

  it('SkeletonRows anuncia la carga una sola vez', () => {
    render(<SkeletonRows rows={3} columns={2} label="Cargando clientes…" />)
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status', { name: 'Cargando clientes…' })).toBeInTheDocument()
  })
})

describe('EmptyState y ErrorState', () => {
  it('vacío con título, descripción y acción', () => {
    render(<EmptyState icon="inbox" title="Todavía no hay pedidos" description="Aparecen al confirmar." action={<button>Nuevo pedido</button>} headingLevel={3} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Todavía no hay pedidos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nuevo pedido' })).toBeInTheDocument()
  })

  it('error se anuncia y reintenta', () => {
    const onRetry = vi.fn()
    render(<ErrorState title="No se pudo leer el listado." onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo leer el listado.')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(onRetry).toHaveBeenCalled()
  })
})
