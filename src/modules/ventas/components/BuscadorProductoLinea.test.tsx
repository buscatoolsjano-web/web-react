// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ProductoListado } from '@/modules/catalogo/types'
import type { PrecioPropuesto } from './ModalCatalogoProductos'

/**
 * El buscador de productos por línea (Fase 163).
 *
 * Lo que lo hace útil: que al escribir aparezcan los que coinciden y que elegir
 * uno devuelva el producto con su precio para rellenar la línea.
 */
const consultar = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({
      productos: [
        { id: 'p1', sku: 'VPPH2/50', nombre: 'Punta Phillips PH2 50mm', precio: 35.5 },
        { id: 'p2', sku: 'VPPH2/25', nombre: 'Punta Phillips PH2 25mm', precio: 20 },
      ] as unknown as ProductoListado[],
      total: 2,
    }),
  ),
)

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', esInterno: true } }),
}))
vi.mock('@/modules/catalogo/services/productos', () => ({ consultarProductos: consultar }))
vi.mock('@/modules/catalogo/lib/planDeConsulta', () => ({ construirPlanDeConsulta: (f: unknown) => f }))
// El árbol de imports llega al service de facetas, que importa el cliente de
// Supabase (valida las env al cargar). En la suite aislada no hay env; se moquea.
vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

const { BuscadorProductoLinea } = await import('./BuscadorProductoLinea')

const elegido = vi.fn<(p: ProductoListado, precio: PrecioPropuesto) => void>()

function Harness() {
  const [v, setV] = useState('')
  return (
    <BuscadorProductoLinea
      valor={v}
      listaPrecioId="pl1"
      moneda="USD"
      historicos={new Map()}
      claseInput="x"
      onTexto={setV}
      onElegir={elegido}
    />
  )
}

function montar() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness />
    </QueryClientProvider>,
  )
}

const input = () => screen.getByRole('combobox', { name: 'Producto' })

beforeEach(() => {
  elegido.mockClear()
  consultar.mockClear()
})

describe('<BuscadorProductoLinea>', () => {
  it('con menos de dos letras no busca nada', () => {
    montar()
    fireEvent.change(input(), { target: { value: 'v' } })
    expect(consultar).not.toHaveBeenCalled()
  })

  it('al escribir muestra los productos que coinciden', async () => {
    montar()
    fireEvent.change(input(), { target: { value: 'vpph' } })

    expect(await screen.findByText('Punta Phillips PH2 50mm')).toBeInTheDocument()
    expect(screen.getByText('VPPH2/50')).toBeInTheDocument()
    // El precio propuesto se ve en la lista.
    expect(screen.getByText(/35[.,]50/)).toBeInTheDocument()
  })

  it('elegir uno devuelve el producto con su precio', async () => {
    montar()
    fireEvent.change(input(), { target: { value: 'vpph' } })
    const opcion = await screen.findByText('Punta Phillips PH2 50mm')

    // `mouseDown` y no `click`: es lo que usa el componente para ganarle al blur.
    fireEvent.mouseDown(opcion)

    expect(elegido).toHaveBeenCalledTimes(1)
    const [producto, precio] = elegido.mock.calls[0]!
    expect(producto.id).toBe('p1')
    expect(precio.precio).toBe(35.5)
  })

  it('Escape cierra la lista sin elegir', async () => {
    montar()
    fireEvent.change(input(), { target: { value: 'vpph' } })
    await screen.findByText('Punta Phillips PH2 50mm')

    fireEvent.keyDown(input(), { key: 'Escape' })

    await waitFor(() =>
      expect(screen.queryByText('Punta Phillips PH2 50mm')).not.toBeInTheDocument(),
    )
    expect(elegido).not.toHaveBeenCalled()
  })
})
