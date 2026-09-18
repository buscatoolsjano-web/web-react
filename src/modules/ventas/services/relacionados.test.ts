import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La cadena de documentos relacionados (Fase 15 · E6).
 *
 * Se mockea el cliente de Supabase con un doble que responde por tabla y
 * registra qué consultas se hicieron. Así se puede afirmar dos cosas que
 * importan: que la cadena se arma bien —incluido el remito que no salió de un
 * pedido— y que **no hay N+1**: una consulta por tabla, no una por documento.
 */
type Fila = Record<string, unknown>

const estado = vi.hoisted((): { tablas: Record<string, Fila[]>; consultas: string[] } => ({
  tablas: {},
  consultas: [],
}))

vi.mock('@/services/supabase/client', () => {
  /** Un constructor de consultas mínimo: filtra en memoria y es "thenable". */
  const constructor = (tabla: string) => {
    estado.consultas.push(tabla)
    const filtros: ((f: Fila) => boolean)[] = []
    const q: Record<string, unknown> = {}
    const encadenar = (fn: (f: Fila) => boolean) => {
      filtros.push(fn)
      return q
    }
    Object.assign(q, {
      select: () => q,
      order: () => q,
      eq: (c: string, v: unknown) => encadenar((f) => f[c] === v),
      in: (c: string, v: unknown[]) => encadenar((f) => v.includes(f[c])),
      is: (c: string, v: unknown) => encadenar((f) => (v === null ? f[c] === null : f[c] === v)),
      maybeSingle: () => {
        const filas = (estado.tablas[tabla] ?? []).filter((f) => filtros.every((p) => p(f)))
        return Promise.resolve({ data: filas[0] ?? null, error: null })
      },
      then: (resolver: (r: { data: Fila[]; error: null }) => unknown) =>
        resolver({ data: (estado.tablas[tabla] ?? []).filter((f) => filtros.every((p) => p(f))), error: null }),
    })
    return q
  }
  return { supabase: { from: (tabla: string) => constructor(tabla) } }
})

const { documentosRelacionados } = await import('./relacionados')

const C = 'empresa-1'

beforeEach(() => {
  estado.consultas = []
  estado.tablas = {
    sales_quotes: [
      { id: 'q1', company_id: C, number: 'COTI001', original_number: null, quote_date: '2026-09-01', status: 'accepted', currency_code: 'USD', total: 121 },
      { id: 'q2', company_id: C, number: 'COTI002', original_number: null, quote_date: '2026-09-02', status: 'sent', currency_code: 'USD', total: 50 },
    ],
    sales_orders: [
      { id: 'o1', company_id: C, number: 'PDV001', original_number: null, order_date: '2026-09-03', commercial_status: 'confirmed', currency_code: 'USD', total: 121, quote_id: 'q1' },
    ],
    deliveries: [
      { id: 'd1', company_id: C, number: 'RT001', original_number: null, delivery_date: '2026-09-04', status: 'shipped', currency_code: 'USD', total: 121, order_id: 'o1', source_quote_id: null },
      { id: 'd2', company_id: C, number: 'RT002', original_number: null, delivery_date: '2026-09-05', status: 'draft', currency_code: 'USD', total: 50, order_id: null, source_quote_id: 'q2' },
      { id: 'd3', company_id: C, number: 'RT003', original_number: null, delivery_date: '2026-09-06', status: 'draft', currency_code: 'USD', total: 10, order_id: null, source_quote_id: null },
    ],
    sales_invoices: [],
    payment_allocations: [],
  }
})

describe('cadena de la cotización', () => {
  it('trae sus pedidos y las entregas de esos pedidos', async () => {
    const r = await documentosRelacionados('cotizacion', C, 'q1')
    expect(r.pedidos.map((p) => p.numero)).toEqual(['PDV001'])
    expect(r.entregas.map((e) => e.numero)).toEqual(['RT001'])
    expect(r.cotizaciones).toEqual([])
  })

  it('una cotización sin pedido no inventa nada', async () => {
    const r = await documentosRelacionados('cotizacion', C, 'q2')
    expect(r.pedidos).toEqual([])
    expect(r.entregas).toEqual([])
  })
})

describe('cadena del pedido', () => {
  it('trae la cotización de origen y sus entregas', async () => {
    const r = await documentosRelacionados('pedido', C, 'o1')
    expect(r.cotizaciones.map((c) => c.numero)).toEqual(['COTI001'])
    expect(r.entregas.map((e) => e.numero)).toEqual(['RT001'])
  })
})

describe('cadena del remito', () => {
  it('trae el pedido y, por él, la cotización', async () => {
    const r = await documentosRelacionados('entrega', C, 'd1')
    expect(r.pedidos.map((p) => p.numero)).toEqual(['PDV001'])
    expect(r.cotizaciones.map((c) => c.numero)).toEqual(['COTI001'])
    // No se lista a sí mismo como relacionado de sí mismo.
    expect(r.entregas.map((e) => e.id)).not.toContain('d1')
  })

  it('un remito que salió de una cotización, sin pedido, muestra ESA cotización', async () => {
    const r = await documentosRelacionados('entrega', C, 'd2')
    expect(r.cotizaciones.map((c) => c.numero)).toEqual(['COTI002'])
    expect(r.pedidos).toEqual([])
  })

  it('un remito suelto no muestra un origen inventado', async () => {
    const r = await documentosRelacionados('entrega', C, 'd3')
    expect(r.cotizaciones).toEqual([])
    expect(r.pedidos).toEqual([])
    expect(r.entregas).toEqual([])
  })
})

describe('sin N+1', () => {
  it('la cadena entera se arma con una consulta por tabla', async () => {
    await documentosRelacionados('cotizacion', C, 'q1')
    const porTabla = estado.consultas.reduce<Record<string, number>>(
      (acc, t) => ({ ...acc, [t]: (acc[t] ?? 0) + 1 }),
      {},
    )
    expect(porTabla['sales_orders']).toBeLessThanOrEqual(2)
    expect(porTabla['deliveries']).toBe(1)
    expect(porTabla['sales_quotes'] ?? 0).toBeLessThanOrEqual(1)
  })

  it('las cobranzas ni se consultan cuando no hay facturas', async () => {
    await documentosRelacionados('pedido', C, 'o1')
    expect(estado.consultas).not.toContain('payment_allocations')
  })
})
