// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Un bloque que falla no puede tirar Informes entero (Fase 21 · E3.1).
 *
 * La pantalla hace cinco consultas independientes: actividad, pipeline,
 * ranking, documentos y facetas. Si el ranking se cae —una RPC lenta, un
 * timeout, un error del servidor— el resumen, el gráfico y los documentos
 * siguen siendo perfectamente útiles, y obligar a recargar toda la pantalla
 * por eso es tratar un problema chico como si fuera grande.
 */
type Respuesta = Promise<{ data: unknown[] | null; error: { message: string } | null }>
const rpc = vi.hoisted(() => vi.fn<(nombre: string, args: unknown) => Respuesta>())

vi.mock('@/services/supabase/client', () => ({
  supabase: {
    rpc: (nombre: string, args: unknown): Respuesta => rpc(nombre, args),
    from: () => {
      const cadena: Record<string, unknown> = {}
      Object.assign(cadena, {
        select: () => cadena,
        eq: () => cadena,
        in: () => cadena,
        is: () => cadena,
        order: () => cadena,
        limit: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        range: () => Promise.resolve({ data: [], error: null }),
      })
      return cadena
    },
  },
}))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: (): { activa: { companyId: string; rol: string; esInterno: boolean } } => ({
    activa: { companyId: 'empresa-1', rol: 'admin', esInterno: true },
  }),
}))

const { InformesPage } = await import('./InformesPage')

/** Una actividad mínima pero real: un mes, una moneda, tres métricas. */
const ACTIVIDAD = [
  { periodo: 'rango_actual', tipo: null, mes: '2026-09-01', desde: '2026-09-01', hasta: '2026-09-22', moneda: null, documentos: 0, importe: 0, en_revision: 0 },
  { periodo: 'rango_anterior', tipo: null, mes: '2026-08-01', desde: '2026-08-01', hasta: '2026-08-22', moneda: null, documentos: 0, importe: 0, en_revision: 0 },
  { periodo: 'actual', tipo: 'cotizaciones', mes: '2026-09-01', desde: '2026-09-01', hasta: '2026-09-22', moneda: 'USD', documentos: 27, importe: 90518.55, en_revision: 0 },
  { periodo: 'anterior', tipo: 'cotizaciones', mes: '2026-08-01', desde: '2026-08-01', hasta: '2026-08-22', moneda: 'USD', documentos: 19, importe: 63000, en_revision: 0 },
  { periodo: 'mes', tipo: 'cotizaciones', mes: '2026-09-01', desde: null, hasta: null, moneda: 'USD', documentos: 27, importe: 90518.55, en_revision: 0 },
]

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/informes']}>
        <InformesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

describe('Una consulta secundaria que falla no tira la pantalla', () => {
  beforeEach(() => {
    rpc.mockReset()
    rpc.mockImplementation((nombre) => {
      if (nombre === 'informe_actividad_comercial') return Promise.resolve({ data: ACTIVIDAD, error: null })
      // El ranking se cae. Todo lo demás contesta.
      if (nombre === 'informe_rankings_comerciales') {
        return Promise.resolve({ data: null, error: { message: 'timeout del servidor' } })
      }
      return Promise.resolve({ data: [], error: null })
    })
  })

  it('el resumen comercial sigue mostrando su número', async () => {
    montar()
    // El importe aparece en el KPI, en el detalle por moneda, en el gráfico y
    // en la tabla de números: son cuatro vistas del mismo dato, no cuatro datos.
    expect((await screen.findAllByText(/90\.518,55/)).length).toBeGreaterThan(0)
  })

  it('la evolución sigue en pie', async () => {
    montar()
    expect(await screen.findByRole('heading', { name: /últimos 12 meses/i })).toBeInTheDocument()
  })

  it('la sección Documentos sigue en pie', async () => {
    montar()
    expect(await screen.findByRole('heading', { name: 'Documentos' })).toBeInTheDocument()
  })

  it('la tabla «Ver los números» muestra los MISMOS valores que el gráfico', async () => {
    montar()
    await screen.findAllByText(/90.518,55/)
    // El gráfico dibuja sep 26 = USD 90.518,55 / 27 cotizaciones, y la tabla
    // escribe septiembre 2026 con los mismos dos números. Salen de la misma
    // llamada, así que no pueden separarse.
    const texto = document.body.textContent ?? ''
    expect(texto).toMatch(/sep 26USD 90.518,5527 cotizaciones/)
    expect(texto).toMatch(/septiembre 2026USD 90.518,5527/)
  })

  it('no aparece el error de pantalla completa', async () => {
    montar()
    await screen.findAllByText(/90\.518,55/)
    // El error de pantalla completa dice «No se pudo leer el informe»; el del
    // bloque dice cuál bloque. Que sean distintos ES el arreglo.
    expect(document.body.textContent).not.toMatch(/No se pudo leer el informe. Prob/i)
  })
})

describe('En cambio, si falla la actividad, la pantalla sí lo dice', () => {
  beforeEach(() => {
    rpc.mockReset()
    rpc.mockImplementation((nombre) =>
      nombre === 'informe_actividad_comercial'
        ? Promise.resolve({ data: null, error: { message: 'sin_permiso' } })
        : Promise.resolve({ data: [], error: null }),
    )
  })

  it('la actividad es el esqueleto: sin ella no hay período ni monedas que mostrar', async () => {
    montar()
    expect(
      await screen.findByText(/no tiene acceso a Informes|Probá de nuevo/i),
    ).toBeInTheDocument()
  })
})
