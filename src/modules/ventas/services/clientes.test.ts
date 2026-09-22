import { describe, expect, it, vi } from 'vitest'

/**
 * El buscador de clientes (Fase 22 · A8).
 *
 * El problema medido: con el campo vacío la consulta salía SIN filtro y
 * devolvía los primeros 20 clientes por orden alfabético. Al tocar «Cliente»
 * aparecían «27 de Julio S.R.L.», «A-Evangelista S.A.»…, que no son
 * sugerencias de nada y encima costaban una consulta cada vez.
 */
const llamadas = vi.hoisted(() => ({ select: 0 }))

vi.mock('@/services/supabase/client', () => {
  const cadena = {
    select: (...a: unknown[]) => {
      llamadas.select++
      void a
      return cadena
    },
    eq: () => cadena,
    is: () => cadena,
    or: () => cadena,
    order: () => cadena,
    limit: () => Promise.resolve({ data: [{ id: 'c1', legal_name: 'NORBERTO S.A.', trade_name: null }], error: null }),
  }
  return { supabase: { from: () => cadena } }
})

const { buscarClientes } = await import('./clientes')

describe('Sin texto no se busca nada', () => {
  it('el campo vacío devuelve cero clientes y NO consulta', async () => {
    llamadas.select = 0
    expect(await buscarClientes('c1', '')).toEqual([])
    expect(llamadas.select).toBe(0)
  })

  it('sólo espacios es lo mismo que vacío', async () => {
    llamadas.select = 0
    expect(await buscarClientes('c1', '   ')).toEqual([])
    expect(llamadas.select).toBe(0)
  })

  it('una sola letra tampoco: «a» son cientos de clientes', async () => {
    llamadas.select = 0
    expect(await buscarClientes('c1', 'a')).toEqual([])
    expect(llamadas.select).toBe(0)
  })

  it('con dos letras sí busca', async () => {
    llamadas.select = 0
    const r = await buscarClientes('c1', 'no')
    expect(llamadas.select).toBe(1)
    expect(r.map((c) => c.nombre)).toEqual(['NORBERTO S.A.'])
  })

  it('los paréntesis y las comas no rompen el filtro de PostgREST', async () => {
    llamadas.select = 0
    await buscarClientes('c1', 'S.A. (ex Norte), 20')
    expect(llamadas.select).toBe(1)
  })
})
