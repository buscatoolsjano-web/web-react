import { describe, expect, it, vi } from 'vitest'
import { FILTROS_INICIALES } from '../types'

/**
 * El filtro «sólo abiertas» del listado (Fase 21 · E3).
 *
 * El problema que cierra: el Dashboard contaba 154 cotizaciones abiertas y el
 * listado mostraba 143, porque no sabía decir «abierta» —filtraba por estado y
 * las 11 aceptadas sin pedido se perdían—.
 *
 * La regla NO está en el front: es la función `abierta(sales_quotes)` de la
 * base, la misma que usa el informe de pipeline, expuesta por PostgREST como
 * columna calculada. Lo que se prueba acá es que el listado la pida —y sólo
 * donde corresponde—, no qué significa estar abierta: eso lo prueba el
 * invariante de la migración, que compara la función contra la regla escrita
 * a mano y falla si difieren.
 */
const llamadas = vi.hoisted(() => ({ filtros: [] as { campo: string; valor: unknown; op: string }[] }))

vi.mock('@/services/supabase/client', () => {
  const cadena: Record<string, unknown> = {}
  const registrar = (op: string) => (campo: string, valor: unknown) => {
    llamadas.filtros.push({ op, campo, valor })
    return cadena
  }
  Object.assign(cadena, {
    select: () => cadena,
    eq: registrar('eq'),
    is: registrar('is'),
    neq: registrar('neq'),
    or: () => cadena,
    ilike: () => cadena,
    gte: () => cadena,
    lte: () => cadena,
    not: () => cadena,
    in: () => cadena,
    order: () => cadena,
    range: () => Promise.resolve({ data: [], count: 0, error: null }),
  })
  return { supabase: { from: () => cadena } }
})

const { listarDocumentos } = await import('./documentos')

const pedirCon = async (tipo: 'cotizacion' | 'pedido' | 'entrega', soloAbiertas: boolean) => {
  llamadas.filtros = []
  await listarDocumentos(tipo, 'c1', { ...FILTROS_INICIALES, soloAbiertas })
  return llamadas.filtros
}

describe('El listado pide la MISMA regla que cuenta el Dashboard', () => {
  it('con abierta=1 filtra por la columna calculada de la base', async () => {
    const f = await pedirCon('cotizacion', true)
    expect(f).toContainEqual({ op: 'is', campo: 'abierta', valor: true })
  })

  it('sin el filtro no lo pide: el listado sigue mostrando todas', async () => {
    const f = await pedirCon('cotizacion', false)
    expect(f.some((x) => x.campo === 'abierta')).toBe(false)
  })

  it('no se define «abierta» en el front: no hay filtro por estado que la imite', async () => {
    const f = await pedirCon('cotizacion', true)
    // Si alguien «resolviera» esto filtrando status=sent, las 11 aceptadas sin
    // pedido volverían a desaparecer y el número volvería a ser 143.
    expect(f.some((x) => x.campo === 'status')).toBe(false)
  })

  it('en pedidos y entregas no aplica: una cotización abierta no es un remito', async () => {
    expect((await pedirCon('pedido', true)).some((x) => x.campo === 'abierta')).toBe(false)
    expect((await pedirCon('entrega', true)).some((x) => x.campo === 'abierta')).toBe(false)
  })
})
