// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const facetas = vi.fn<(...a: unknown[]) => Promise<unknown>>()
const productos = vi.fn<(...a: unknown[]) => Promise<unknown>>()
vi.mock('../services/facetas', () => ({ obtenerFacetas: (...a: unknown[]) => facetas(...a) }))
vi.mock('../services/productos', () => ({ consultarProductos: (...a: unknown[]) => productos(...a) }))

import { reiniciarAnticipos, useAnticiparFiltro } from './useAnticiparFiltro'
import { leerFiltros } from './useFiltrosCatalogo'

function envoltorio(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useAnticiparFiltro', () => {
  beforeEach(() => {
    reiniciarAnticipos()
    facetas.mockReset()
    productos.mockReset()
  })

  it('no arranca un anticipo nuevo mientras hay otro pendiente', async () => {
    let soltar: () => void = () => {}
    facetas.mockImplementation(() => new Promise((r) => (soltar = () => r({}))))
    productos.mockResolvedValue({ productos: [], total: 0 })
    const qc = new QueryClient()
    const filtros = leerFiltros(new URLSearchParams())
    const { result } = renderHook(() => useAnticiparFiltro('co', filtros, 'lista', true, true), {
      wrapper: envoltorio(qc),
    })

    result.current({ categoria: 'a' })
    result.current({ categoria: 'b' })
    result.current({ categoria: 'c' })
    await vi.waitFor(() => expect(facetas).toHaveBeenCalledTimes(1))
    expect(productos).toHaveBeenCalledTimes(1)

    // Terminado el primero, el siguiente sí sale.
    soltar()
    await vi.waitFor(() => {
      result.current({ categoria: 'd' })
      expect(facetas).toHaveBeenCalledTimes(2)
    })
  })
})
