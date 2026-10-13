// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

/* Declarada afuera y usada adentro de `vi.hoisted`: los tipos se borran al
   compilar, así que no hay nada que hoistear ni orden que respetar. */
interface Socio {
  companyId: string
  companyName: string
  rol: string
  esInterno: boolean
  listasDePrecios: { id: string; nombre: string; esPorDefecto: boolean }[]
}

const estado = vi.hoisted(
  (): { activa: Socio | null; cargando: boolean; consultas: number } => ({
    activa: {
      companyId: 'c1',
      companyName: 'Buscatools',
      rol: 'admin',
      esInterno: true,
      listasDePrecios: [{ id: 'lista-base', nombre: 'Lista base', esPorDefecto: true }],
    },
    cargando: false,
    /** Cuántas veces se fue de verdad al servidor. */
    consultas: 0,
  }),
)

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: estado.activa, cargando: estado.cargando }),
}))
vi.mock('../services/productos', () => ({
  consultarProductos: () => {
    estado.consultas++
    return Promise.resolve({ productos: [], total: 0 })
  },
}))

const { usePrecalentarCatalogo, claveDeLaPrimeraPagina } = await import('./usePrecalentarCatalogo')
const { useProductos } = await import('./useProductos')
const { FILTROS_INICIALES } = await import('../types')

function envoltorio(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const nuevoCliente = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } })

describe('usePrecalentarCatalogo', () => {
  /*
   * ── EL TEST QUE JUSTIFICA QUE LA CLAVE ESTÉ EXPORTADA ─────────────────────
   *
   * Una clave que se PARECE a la de `useProductos` pero no es igual convierte
   * el precalentado en una consulta de más que no ahorra nada. Y falla en
   * silencio: la pantalla sigue andando, sólo que igual de lenta. Por eso se
   * compara contra la que arma la consulta de verdad, no contra una copia
   * escrita a mano en el test.
   */
  it('usa EXACTAMENTE la misma clave que la consulta del catálogo', async () => {
    const qc = nuevoCliente()
    renderHook(() => useProductos(FILTROS_INICIALES, 'lista-base', true), {
      wrapper: envoltorio(qc),
    })

    await waitFor(() => expect(qc.getQueryCache().getAll().length).toBe(1))
    const laDeVerdad = qc.getQueryCache().getAll()[0]?.queryKey

    expect(laDeVerdad).toEqual(claveDeLaPrimeraPagina('c1', 'lista-base', true))
  })

  it('deja la primera página servida antes de que nadie la pida', async () => {
    const qc = nuevoCliente()
    renderHook(() => usePrecalentarCatalogo(true), { wrapper: envoltorio(qc) })

    await waitFor(() =>
      expect(qc.getQueryData(claveDeLaPrimeraPagina('c1', 'lista-base', true))).toBeDefined(),
    )
  })

  /*
   * LA PRUEBA DE QUE SIRVE: después de precalentar, montar el catálogo no
   * dispara una consulta nueva. Si la clave estuviera mal, acá habría dos.
   */
  it('después de precalentar, abrir el catálogo no vuelve a consultar', async () => {
    const qc = nuevoCliente()
    estado.consultas = 0

    renderHook(() => usePrecalentarCatalogo(true), { wrapper: envoltorio(qc) })
    await waitFor(() =>
      expect(qc.getQueryData(claveDeLaPrimeraPagina('c1', 'lista-base', true))).toBeDefined(),
    )
    expect(estado.consultas).toBe(1)

    renderHook(() => useProductos(FILTROS_INICIALES, 'lista-base', true), {
      wrapper: envoltorio(qc),
    })
    await waitFor(() => expect(qc.getQueryCache().getAll().length).toBe(1))

    // La misma: el catálogo encontró la página servida.
    expect(estado.consultas).toBe(1)
  })

  it('apagado no consulta nada', async () => {
    const qc = nuevoCliente()
    estado.consultas = 0
    renderHook(() => usePrecalentarCatalogo(false), { wrapper: envoltorio(qc) })
    await new Promise((r) => setTimeout(r, 50))
    expect(estado.consultas).toBe(0)
  })

  /* Sin empresa resuelta no hay con qué armar la clave, así que no se pide. */
  it('sin empresa todavía, espera', async () => {
    const qc = nuevoCliente()
    estado.consultas = 0
    estado.activa = null
    estado.cargando = true
    renderHook(() => usePrecalentarCatalogo(true), { wrapper: envoltorio(qc) })
    await new Promise((r) => setTimeout(r, 50))
    expect(estado.consultas).toBe(0)

    estado.activa = {
      companyId: 'c1',
      companyName: 'Buscatools',
      rol: 'admin',
      esInterno: true,
      listasDePrecios: [{ id: 'lista-base', nombre: 'Lista base', esPorDefecto: true }],
    }
    estado.cargando = false
  })
})
