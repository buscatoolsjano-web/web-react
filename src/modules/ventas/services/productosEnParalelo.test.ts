import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Las consultas salen EN PARALELO, no una después de la otra (Fase 61).
 *
 * Desde Argentina cada ida y vuelta a São Paulo cuesta ~220 ms fijos, así que
 * lo caro no es la cantidad de consultas: es encadenarlas. `productosPorId`
 * hacía tres viajes en fila —la lista de precios, las filas, el PVP— para
 * reabrir una cotización guardada, y ninguno dependía de los otros: los ids
 * llegan como argumento.
 *
 * ESTE TEST MIRA EL ORDEN, NO EL RESULTADO. Un test que sólo comprobara los
 * precios pasaría igual con las tres en fila, que es exactamente el bug: el
 * resultado era correcto y tardaba el triple. Lo que se verifica es que las
 * tres estén EN VUELO a la vez.
 *
 * Instrumenta el `.then` del constructor de consultas, que es donde el cliente
 * de Supabase dispara el pedido de verdad: sus builders son perezosos y no
 * salen a la red hasta que alguien los espera.
 */

interface Traza {
  tabla: string
  /** Tick del reloj en que se disparó. */
  salida: number
  /** Tick del reloj en que contestó. */
  vuelta: number
}

/*
 * UN SOLO RELOJ para salidas y vueltas, y no un contador para cada una.
 *
 * Con dos contadores la aserción era vacua: encadenadas, las salidas son
 * igual 1,2,3 y las vueltas también, así que «la última salida es la 3 y la
 * primera vuelta es la 1» se cumplía en los dos casos. Lo verifiqué volviendo
 * a encadenar el código a propósito: el test pasaba. Con un reloj compartido,
 * en paralelo las tres salidas ocupan los ticks 1-3 y las vueltas el 4-6; en
 * fila se intercalan (salida, vuelta, salida, vuelta…) y no hay forma de que
 * la última salida caiga antes de la primera vuelta.
 */
interface EstadoMock {
  traza: Traza[]
  reloj: number
  /** Qué devuelve cada tabla. `undefined` simula una consulta que falla. */
  datos: Record<string, unknown[] | undefined>
  /** Milisegundos que tarda cada tabla en contestar. */
  demora: Record<string, number>
}

const estado = vi.hoisted<EstadoMock>(() => ({ traza: [], reloj: 0, datos: {}, demora: {} }))

vi.mock('@/services/supabase/client', () => {
  /** Un builder perezoso: el pedido «sale» recién cuando alguien lo espera. */
  function constructor(tabla: string) {
    const disparar = () => {
      const salida = ++estado.reloj
      const ms = estado.demora[tabla] ?? 1
      return new Promise<{ data: unknown[]; error: null }>((resolver) => {
        setTimeout(() => {
          estado.traza.push({ tabla, salida, vuelta: ++estado.reloj })
          resolver({ data: estado.datos[tabla] ?? [], error: null })
        }, ms)
      })
    }

    const q: Record<string, unknown> = {}
    for (const metodo of ['select', 'eq', 'in', 'order', 'limit']) q[metodo] = () => q
    // `maybeSingle` y `then` son los dos finales: los dos disparan.
    q.maybeSingle = () => disparar().then((r) => ({ data: r.data[0] ?? null, error: null }))
    q.then = (alCumplir: (v: unknown) => unknown, alFallar?: (e: unknown) => unknown) =>
      disparar().then(alCumplir, alFallar)
    return q
  }

  return {
    supabase: {
      from: (tabla: string) => constructor(tabla),
      rpc: () => constructor('rpc'),
    },
  }
})

const { productosPorId } = await import('./productosParaLinea')

const deTabla = (t: string): Traza | undefined => estado.traza.find((x) => x.tabla === t)

beforeEach(() => {
  estado.traza = []
  estado.reloj = 0
  estado.demora = {}
  estado.datos = {
    price_lists: [{ id: 'lista-1', name: 'Mayorista', currency_code: 'USD' }],
    products: [
      { id: 'p1', sku: 'SP.001', name: 'Adaptador', brands: { name: 'SPEEDRILL' },
        product_prices: [{ amount: 100, price_list_id: 'lista-1', valid_from: '2020-01-01', valid_to: null }] },
    ],
    product_pvp: [
      { product_id: 'p1', reference: 'SP.001', costo: 50, moneda_costo: 'EUR',
        fecha_costo: '2026-01-01', multiplier: 3, base_is_cost: true, pvp: 150 },
    ],
  }
})

describe('productosPorId · las tres consultas a la vez', () => {
  /*
   * EL TEST QUE IMPORTA. Las tres tienen que SALIR antes de que vuelva la
   * primera. Si estuvieran encadenadas, la segunda saldría después de la
   * vuelta de la primera y este orden sería imposible.
   */
  it('las tres salen antes de que conteste ninguna', async () => {
    await productosPorId('empresa-1', ['p1'])

    expect(estado.traza).toHaveLength(3)
    const ultimaSalida = Math.max(...estado.traza.map((t) => t.salida))
    const primeraVuelta = Math.min(...estado.traza.map((t) => t.vuelta))
    // En el MISMO reloj: la última salió antes de que volviera la primera.
    // Encadenadas esto es imposible: la segunda sale después de la vuelta de
    // la primera, así que la última salida siempre caería más tarde.
    expect(ultimaSalida).toBeLessThan(primeraVuelta)
  })

  it('consulta la lista de precios, los productos y el PVP, y nada más', async () => {
    await productosPorId('empresa-1', ['p1'])
    expect(estado.traza.map((t) => t.tabla).sort()).toEqual(['price_lists', 'product_pvp', 'products'])
  })

  /*
   * La prueba por el otro lado: con la consulta de productos lenta, el PVP y
   * la lista igual contestan antes. Encadenadas no podrían — tendrían que
   * esperar a que la lenta terminara.
   */
  it('una consulta lenta no retrasa a las otras dos', async () => {
    estado.demora = { products: 30, price_lists: 1, product_pvp: 1 }
    await productosPorId('empresa-1', ['p1'])

    // Las dos rápidas vuelven ANTES que la lenta, aunque la lenta haya salido
    // primera. Encadenadas sería al revés: cada una espera a la anterior, así
    // que el orden de vuelta copiaría el de salida.
    const lenta = deTabla('products')!
    expect(deTabla('price_lists')!.vuelta).toBeLessThan(lenta.vuelta)
    expect(deTabla('product_pvp')!.vuelta).toBeLessThan(lenta.vuelta)
    // Y las tres ya habían salido antes de que volviera la lenta: ninguna
    // estuvo esperándola. (El orden ENTRE las tres salidas no se fija: es un
    // detalle de cómo arranca cada builder, no la propiedad que importa.)
    expect(Math.max(...estado.traza.map((t) => t.salida))).toBeLessThan(lenta.vuelta)
  })

  /* Y el resultado sigue siendo el correcto: el PVP (50 × 3 = 150) le gana al
     precio de la tarifa (100). Mover consultas de lugar no puede cambiar lo
     que sale en pantalla. */
  it('el precio sale del PVP, no de la tarifa', async () => {
    const r = await productosPorId('empresa-1', ['p1'])
    expect(r).toHaveLength(1)
    expect(r[0]?.precio).toBe(150)
    expect(r[0]?.tarifaNombre).toBe('Mayorista')
  })

  /*
   * SI EL PVP FALLA, LA COTIZACIÓN SE TIENE QUE PODER CARGAR IGUAL. Dentro de
   * un `Promise.all` una excepción voltearía también las otras dos consultas,
   * así que `pedirPvp` no tira: devuelve el mapa vacío y quedan los precios de
   * la tarifa.
   */
  it('si el PVP falla, quedan los precios de la tarifa', async () => {
    estado.datos = { ...estado.datos, product_pvp: undefined }
    const r = await productosPorId('empresa-1', ['p1'])
    expect(r[0]?.precio).toBe(100)
  })

  it('sin ids no sale ninguna consulta', async () => {
    expect(await productosPorId('empresa-1', [])).toEqual([])
    expect(estado.traza).toHaveLength(0)
  })
})
