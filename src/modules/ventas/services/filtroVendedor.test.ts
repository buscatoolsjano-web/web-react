import { describe, expect, it, vi } from 'vitest'
import { FILTROS_INICIALES, SIN_VENDEDOR } from '../types'

/**
 * El filtro por vendedor del listado (Fase 73).
 *
 * LO QUE HAY QUE PROBAR es que el filtro pregunte lo MISMO que muestra la
 * columna Vendedor: el vendedor cargado y, cuando no hay, quien lo creó. Si
 * preguntara sólo por `salesperson_id` —que está vacío en los 751 documentos—
 * elegir a alguien devolvería una lista vacía al lado de una columna que dice
 * su nombre en veinte filas. Esa contradicción es el bug que esto previene.
 *
 * El remito es el caso aparte: no tiene `salesperson_id` —el vendedor es del
 * pedido, no del remito—, así que ahí la pregunta es sólo por el autor. Pedir
 * la columna igual no devuelve null: devuelve un error de PostgREST.
 */
const llamadas = vi.hoisted(() => ({
  filtros: [] as { op: string; campo: string; valor: unknown }[],
  ors: [] as string[],
}))

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
    or: (expr: string) => {
      llamadas.ors.push(expr)
      return cadena
    },
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

const pedirCon = async (tipo: 'cotizacion' | 'pedido' | 'entrega', vendedorId: string | null) => {
  llamadas.filtros = []
  llamadas.ors = []
  await listarDocumentos(tipo, 'c1', { ...FILTROS_INICIALES, vendedorId })
  return llamadas
}

describe('El filtro pregunta lo mismo que muestra la columna', () => {
  it('en cotizaciones y pedidos: el vendedor, o sin vendedor y lo creó él', async () => {
    for (const tipo of ['cotizacion', 'pedido'] as const) {
      const r = await pedirCon(tipo, 'u-jano')
      expect(r.ors).toEqual([
        'salesperson_id.eq.u-jano,and(salesperson_id.is.null,created_by.eq.u-jano)',
      ])
    }
  })

  /* El remito no tiene vendedor propio: la pregunta es por el autor y nada
     más. Pedir `salesperson_id` ahí rompe la consulta entera. */
  it('en remitos pregunta sólo por quién lo creó', async () => {
    const r = await pedirCon('entrega', 'u-jano')
    expect(r.ors).toEqual([])
    expect(r.filtros).toContainEqual({ op: 'eq', campo: 'created_by', valor: 'u-jano' })
    expect(r.filtros.some((f) => f.campo === 'salesperson_id')).toBe(false)
  })

  /*
   * «Sin vendedor» no es un hueco: son los 155 documentos que entraron por la
   * sincronización de STEL, que no tienen vendedor NI autor. Es el montón que
   * hay que repartir, y por eso se puede pedir.
   */
  it('«sin vendedor» son los que no tienen ninguno de los dos', async () => {
    const r = await pedirCon('pedido', SIN_VENDEDOR)
    expect(r.ors).toEqual([])
    expect(r.filtros).toContainEqual({ op: 'is', campo: 'salesperson_id', valor: null })
    expect(r.filtros).toContainEqual({ op: 'is', campo: 'created_by', valor: null })
  })

  it('en remitos, «sin vendedor» es sin autor', async () => {
    const r = await pedirCon('entrega', SIN_VENDEDOR)
    expect(r.filtros).toContainEqual({ op: 'is', campo: 'created_by', valor: null })
    expect(r.filtros.some((f) => f.campo === 'salesperson_id')).toBe(false)
  })

  it('sin filtro no pregunta nada de vendedores: la lista sigue completa', async () => {
    const r = await pedirCon('pedido', null)
    expect(r.ors).toEqual([])
    expect(r.filtros.some((f) => f.campo === 'salesperson_id' || f.campo === 'created_by')).toBe(false)
  })
})
