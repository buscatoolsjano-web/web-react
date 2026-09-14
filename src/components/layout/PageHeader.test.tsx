// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PageHeader } from './PageHeader'
import { NotFoundPage } from '@/app/NotFoundPage'

const conRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('PageHeader', () => {
  it('h1, estado, subtítulo, acciones y volver', () => {
    conRouter(
      <PageHeader
        title="PED-00002"
        status={<span>Confirmado</span>}
        subtitle="ZZ Cliente · 12/09/2026"
        back={{ to: '/ventas/pedidos', label: 'Pedidos' }}
        actions={<button>Nota de entrega</button>}
      />,
    )
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('PED-00002')
    expect(screen.getByRole('link', { name: 'Pedidos' })).toHaveAttribute('href', '/ventas/pedidos')
    expect(screen.getByText('Confirmado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nota de entrega' })).toBeInTheDocument()
  })

  it('migas: la última es la página actual', () => {
    conRouter(<PageHeader title="Marcas" breadcrumbs={[{ label: 'Configuración', to: '/configuracion' }, { label: 'Marcas' }]} />)
    const nav = screen.getByRole('navigation', { name: 'Ruta' })
    expect(nav.querySelector('a')).toHaveAttribute('href', '/configuracion')
    expect(screen.getByText('Marcas', { selector: '[aria-current="page"]' })).toBeInTheDocument()
  })
})

describe('404', () => {
  it('h1 propio y salida al inicio, sin «todavía no fue migrada»', () => {
    conRouter(<NotFoundPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'No encontramos esta pantalla' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ir al inicio' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/migrada/)
  })
})
