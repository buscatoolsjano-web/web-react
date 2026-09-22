// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResumenStock } from '../types'

/**
 * La precarga de Stock (Fase 21 · E3).
 *
 * Lo que arregla: la pantalla montaba la tabla, los movimientos y el conteo
 * del catálogo recién cuando contestaba `informe_stock_resumen`, porque les
 * pasa los depósitos por prop. Ninguna de las tres lo necesita para salir.
 * Medido en carga fría, esa espera costaba una cascada: el resumen a los
 * 0,9 s, las otras tres a los 1,6 s, el último dato a los 3,5 s.
 *
 * `usePrecargaStock` las arranca junto con el resumen. El riesgo del arreglo
 * es que sea una consulta de más en vez de la misma: TanStack Query arma la
 * clave con los VALORES de los filtros, así que alcanza con que alguien
 * cambie el filtro inicial de un lado —«que abra mostrando sólo lo que tiene
 * stock», por ejemplo— para que se pidan dos veces, sin que nada se rompa a
 * la vista. Esto es lo que prueba este test: UNA llamada por informe.
 *
 * Comprobado rompiéndolo: con el valor inicial cambiado en TablaStock, dos de
 * estos tests fallan.
 */
type Respuesta = Promise<{ data: unknown[]; error: null }>
const rpc = vi.hoisted(() => vi.fn<(nombre: string, args: unknown) => Promise<{ data: unknown[]; error: null }>>())

vi.mock('@/services/supabase/client', () => ({
  supabase: { rpc: (nombre: string, args: unknown): Respuesta => rpc(nombre, args) },
}))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: (): { activa: { companyId: string; rol: string } } => ({
    activa: { companyId: 'empresa-1', rol: 'admin' },
  }),
}))

const { MovimientosStock } = await import('./MovimientosStock')
const { TablaStock } = await import('./TablaStock')
const { usePrecargaStock } = await import('../hooks/useStock')

const RESUMEN: ResumenStock = {
  mes: { desde: '2026-09-01', hasta: '2026-09-22' },
  total: { con_stock: 0, en_cero: 0, stock_negativo: 0, disponible_negativo: 0, con_reservas: 0 },
  depositos: [],
  productos: { conBalance: 0, conMovimientos: 0, movidoHoyEnCero: 0 },
  ultimoMovimiento: { '0_30': 0, '31_90': 0, '91_180': 0, '181_365': 0, mas_365: 0 },
  movimientosMes: { movimientos: 0, entradas: 0, salidas: 0, productos: 0, depositos: 0, sinDocumento: 0 },
  porTipo: [],
  porOrigen: [],
}

/** La pantalla real: la precarga arriba y los componentes con su estado inicial. */
function Pantalla() {
  usePrecargaStock(null)
  return (
    <>
      <TablaStock depositos={[]} onVerKardex={() => {}} />
      <MovimientosStock mes={null} etiquetaMes="sep 2026" resumen={RESUMEN} />
    </>
  )
}

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Pantalla />
      </MemoryRouter>
    </QueryClientProvider>,
  )

const llamadasA = (nombre: string) => rpc.mock.calls.filter((c) => c[0] === nombre)

describe('La precarga pide lo mismo que los componentes, no algo parecido', () => {
  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValue({ data: [], error: null })
  })

  it('cada informe se pide UNA vez, aunque lo pidan la precarga y el componente', async () => {
    montar()
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    // Si el filtro inicial del componente y el de la precarga dejan de valer
    // lo mismo, acá aparecen 2 y el test lo dice.
    await waitFor(() => {
      expect(llamadasA('informe_stock_actual')).toHaveLength(1)
      expect(llamadasA('informe_movimientos_stock')).toHaveLength(1)
      expect(llamadasA('informe_stock_catalogo')).toHaveLength(1)
    })
  })

  it('las pide sin filtros: es la primera pantalla, no una búsqueda', async () => {
    montar()
    await waitFor(() => expect(llamadasA('informe_stock_actual')).toHaveLength(1))
    expect(llamadasA('informe_stock_actual')[0]?.[1]).toMatchObject({
      p_busqueda: null,
      p_deposito: null,
      p_estado: null,
      p_desplazamiento: 0,
    })
    expect(llamadasA('informe_movimientos_stock')[0]?.[1]).toMatchObject({
      p_deposito: null,
      p_tipo: null,
      p_sentido: null,
      p_desplazamiento: 0,
    })
  })

  it('no arrastra el resumen: la precarga no lo pide, lo pide la vista', async () => {
    montar()
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(llamadasA('informe_stock_resumen')).toHaveLength(0)
  })

  it('el kardex no se precarga: no hay producto elegido todavía', async () => {
    montar()
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(llamadasA('informe_kardex_producto')).toHaveLength(0)
  })

  it('la tabla sigue mostrando sus filtros, no quedó congelada', async () => {
    montar()
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(await screen.findByPlaceholderText(/Buscar/)).toBeInTheDocument()
  })
})
