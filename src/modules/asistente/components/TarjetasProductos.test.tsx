// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ProductoNombrado } from '../services/asistente'
import { TarjetasProductos } from './TarjetasProductos'

const estado = vi.hoisted(() => ({
  resueltos: new Map<string, { id: string; sku: string; nombre: string }>(),
  sumados: [] as { id: string; sku: string; nombre: string }[],
}))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1' }, cargando: false }),
}))

vi.mock('../services/porSku', () => ({
  resolverPorSku: vi.fn(() => Promise.resolve(estado.resueltos)),
}))

vi.mock('@/modules/catalogo/hooks/useCarrito', () => ({
  useCarrito: () => ({
    cantidadDe: () => 0,
    producto: (p: { id: string; sku: string; nombre: string }) => ({
      sumar: () => estado.sumados.push(p),
    }),
  }),
}))

const prod = (p: Partial<ProductoNombrado> = {}): ProductoNombrado => ({
  sku: 'SP.PH2',
  nombre: 'SPEEDRILL PH2 PHILLIPS',
  precio: 1.81,
  moneda: 'USD',
  disponible: 400,
  ...p,
})

function montar(productos: ProductoNombrado[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TarjetasProductos productos={productos} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  estado.resueltos = new Map([['SP.PH2', { id: 'p-1', sku: 'SP.PH2', nombre: 'SPEEDRILL PH2 PHILLIPS' }]])
  estado.sumados = []
})

/*
 * Las tarjetas de producto dentro del chat (Fase 40).
 *
 * Antes el asistente contestaba «SP.PH2 — SPEEDRILL: USD 1,81; stock 400» y
 * ahí se terminaba: para hacer algo había que copiar el SKU e irse al
 * catálogo. Lo que importa probar es que las dos acciones lleven a algún lado
 * y que no se ofrezca una acción que todavía no puede funcionar.
 */
describe('<TarjetasProductos>', () => {
  it('dibuja una tarjeta por producto, con precio y saldo', () => {
    montar([prod()])
    expect(screen.getByText('SP.PH2')).toBeInTheDocument()
    expect(screen.getByText('SPEEDRILL PH2 PHILLIPS')).toBeInTheDocument()
    // El saldo se dice con palabras: un «400» suelto al lado de un precio se
    // lee como otro precio.
    expect(screen.getByText('400 disponibles')).toBeInTheDocument()
  })

  it('«Ver» lleva al producto en el catálogo, por SKU', () => {
    montar([prod()])
    expect(screen.getByRole('link', { name: /Ver/ })).toHaveAttribute('href', '/catalogo/SP.PH2')
  })

  it('un SKU con caracteres raros va escapado en el link', () => {
    // Hay SKU como `SP.VPPH2/50`: sin escapar, la barra inventa otro segmento.
    montar([prod({ sku: 'SP.VPPH2/50' })])
    expect(screen.getByRole('link', { name: /Ver/ })).toHaveAttribute(
      'href',
      '/catalogo/SP.VPPH2%2F50',
    )
  })

  it('«Agregar» suma al carrito el producto resuelto', async () => {
    montar([prod()])
    const boton = screen.getByRole('button', { name: /Agregar SP.PH2 a la cotización/ })
    await waitFor(() => expect(boton).toBeEnabled())
    fireEvent.click(boton)
    // Con el ID real, no con el SKU: el carrito guarda identidad.
    expect(estado.sumados).toEqual([{ id: 'p-1', sku: 'SP.PH2', nombre: 'SPEEDRILL PH2 PHILLIPS' }])
  })

  it('si el SKU no existe en el catálogo, no se puede agregar', async () => {
    // Pasa si el modelo nombra algo que ya no está. Un botón que no hace nada
    // es peor que un botón apagado.
    estado.resueltos = new Map()
    montar([prod()])
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Agregar SP.PH2/ })).toBeDisabled(),
    )
    // Pero mirarlo sigue siendo posible.
    expect(screen.getByRole('link', { name: /Ver/ })).toBeInTheDocument()
  })

  it('un producto sin precio lo dice, no muestra cero', () => {
    montar([prod({ precio: null, disponible: 0 })])
    expect(screen.getByText('Sin precio')).toBeInTheDocument()
    expect(screen.getByText('sin stock')).toBeInTheDocument()
  })

  it('sin productos no dibuja nada', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <TarjetasProductos productos={[]} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(container.querySelector('ul')).toBeNull()
  })
})
