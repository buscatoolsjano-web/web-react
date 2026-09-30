import { describe, expect, it } from 'vitest'
import { AGENTE_RAIZ, revisarRegistro, todosLosAgentes } from './agentes.ts'
import { HERRAMIENTAS, esquemaParaModelo, herramienta } from './herramientas.ts'
import {
  type Entorno,
  type LlamadaHerramienta,
  type Mensaje,
  type PedidoAlModelo,
  type RespuestaModelo,
  responder,
} from './bucle.ts'

/**
 * Un modelo de mentira, programado con un guion.
 *
 * Es la única forma de probar los límites: con el modelo de verdad, «se
 * consultan en círculo» y «se quedó sin presupuesto» dependen de que el
 * modelo se porte igual dos veces seguidas, que es justamente lo que no hace.
 */
function modeloGuionado(guion: (pedido: PedidoAlModelo, n: number) => RespuestaModelo) {
  const pedidos: PedidoAlModelo[] = []
  let n = 0
  const modelo = (pedido: PedidoAlModelo): Promise<RespuestaModelo> => {
    pedidos.push(pedido)
    return Promise.resolve(guion(pedido, n++))
  }
  return { modelo, pedidos }
}

const llamada = (nombre: string, argumentos: Record<string, unknown> = {}): LlamadaHerramienta => ({
  id: `c${Math.random().toString(36).slice(2, 8)}`,
  nombre,
  argumentos,
})

const contesta = (texto: string): RespuestaModelo => ({ texto, llamadas: [] })
const pide = (...ll: LlamadaHerramienta[]): RespuestaModelo => ({ texto: '', llamadas: ll })

/** Qué agente está corriendo, deducido del prompt de sistema. */
const agenteDe = (p: PedidoAlModelo): string => {
  for (const a of todosLosAgentes()) if (p.sistema.includes(a.prompt)) return a.id
  return '?'
}

const preguntar = (texto: string): Mensaje[] => [{ rol: 'usuario', texto }]

describe('El registro de agentes', () => {
  /**
   * Los tres errores que rompen esto —una herramienta que no existe, un colega
   * que no existe, un agente que se consulta a sí mismo— no fallan al
   * desplegar: fallan en producción como un agente que se disculpa sin decir
   * por qué. Se revisan acá.
   */
  it('es coherente: no hay herramientas ni colegas fantasma', () => {
    expect(revisarRegistro()).toEqual([])
  })

  it('el general no tiene herramientas de datos: su trabajo es derivar', () => {
    const g = todosLosAgentes().find((a) => a.id === AGENTE_RAIZ)
    expect(g?.herramientas).toEqual([])
    expect(g?.consulta.length).toBeGreaterThan(2)
  })

  /**
   * `additionalProperties: false` no es decoración: sin eso el modelo agrega
   * parámetros que la RPC no tiene y la llamada falla.
   */
  it('toda herramienta cierra su esquema y describe cada parámetro', () => {
    for (const h of HERRAMIENTAS) {
      const e = esquemaParaModelo(h) as { parameters: Record<string, unknown> }
      expect(e.parameters['additionalProperties']).toBe(false)
      for (const [nombre, p] of Object.entries(h.parametros)) {
        expect(p.description, `${h.id}.${nombre} sin descripción`).toBeTruthy()
      }
      for (const req of h.obligatorios) {
        expect(Object.keys(h.parametros), `${h.id}: obligatorio inexistente`).toContain(req)
      }
    }
  })

  /** El modelo nunca ve un UUID: los pone el servidor desde el JWT. */
  it('ninguna herramienta le pide a la IA un identificador interno', () => {
    for (const h of HERRAMIENTAS) {
      for (const nombre of Object.keys(h.parametros)) {
        expect(nombre, `${h.id}`).not.toMatch(/(^|_)(id|uuid|company)$/)
      }
    }
  })
})

describe('El bucle · el camino feliz', () => {
  it('contesta sin herramientas cuando no hace falta ninguna', async () => {
    const { modelo } = modeloGuionado(() => contesta('Hola, ¿en qué te ayudo?'))
    const entorno: Entorno = { modelo, ejecutar: () => Promise.resolve('') }

    const r = await responder(entorno, preguntar('hola'))
    expect(r.texto).toBe('Hola, ¿en qué te ayudo?')
    expect(r.llamadas).toBe(1)
    expect(r.pasos).toEqual([])
  })

  it('deriva a un colega, que usa su herramienta, y el general junta la respuesta', async () => {
    const { modelo } = modeloGuionado((p, n) => {
      const quien = agenteDe(p)
      if (quien === 'general') return n === 0 ? pide(llamada('preguntar_a_catalogo', { pregunta: '¿hay punta PH2?' })) : contesta('Sí: SP.2008VP/100, 4 disponibles.')
      if (quien === 'catalogo') return n === 1 ? pide(llamada('buscar_productos', { texto: 'punta PH2' })) : contesta('SP.2008VP/100, 4 disponibles.')
      return contesta('?')
    })
    const entorno: Entorno = {
      modelo,
      ejecutar: (nombre) => Promise.resolve(nombre === 'buscar_productos' ? 'SKU:SP.2008VP/100 | stock 4' : ''),
    }

    const r = await responder(entorno, preguntar('¿tenemos punta PH2?'))
    expect(r.texto).toContain('SP.2008VP/100')
    // La traza deja ver la derivación, que es lo que se muestra en pantalla.
    expect(r.pasos.map((p) => `${p.agente}→${p.nombre}`)).toEqual([
      'general→catalogo',
      'catalogo→buscar_productos',
    ])
  })

  /**
   * Lo que una expresión regular no sabe hacer: una pregunta que cruza dos
   * temas. En la web vieja, «¿algún mail con una orden de compra?» caía en
   * Compras —matcheaba «orden de compra»— y contestaba que no veía los
   * correos; hubo que parchearlo con una regla de prioridad a mano.
   */
  it('consulta a DOS colegas cuando la pregunta cruza dos temas, y en paralelo', async () => {
    let enVuelo = 0
    let simultaneos = 0
    const { modelo } = modeloGuionado((p, n) => {
      const quien = agenteDe(p)
      if (quien === 'general') {
        return n === 0
          ? pide(
              llamada('preguntar_a_emails', { pregunta: '¿llegó algún mail con una OC?' }),
              llamada('preguntar_a_ventas', { pregunta: '¿hay cotizaciones abiertas?' }),
            )
          : contesta('Llegó un mail de Mirgor y hay 2 cotizaciones abiertas.')
      }
      return contesta(quien === 'emails' ? 'Un mail de Mirgor.' : '2 cotizaciones abiertas.')
    })
    const entorno: Entorno = {
      modelo: async (p) => {
        enVuelo++
        simultaneos = Math.max(simultaneos, enVuelo)
        try {
          return await modelo(p)
        } finally {
          enVuelo--
        }
      },
      ejecutar: () => Promise.resolve(''),
    }

    const r = await responder(entorno, preguntar('¿llegó algún mail con una orden de compra y qué cotizaciones hay?'))
    expect(r.texto).toContain('Mirgor')
    expect(r.pasos.filter((p) => p.tipo === 'consulta').map((p) => p.nombre).sort()).toEqual(['emails', 'ventas'])
    expect(simultaneos, 'las dos consultas tienen que salir juntas').toBeGreaterThan(1)
  })
})

describe('El bucle · los cortes', () => {
  /**
   * El que separa «un ejército de agentes» de «una cuenta de OpenAI
   * vaciándose sola». Tres agentes que se consultan en círculo no dan error:
   * dan una espera infinita y una factura.
   */
  it('un colega que ya está en la pila NO se le ofrece al modelo', async () => {
    const vistas: string[][] = []
    const { modelo } = modeloGuionado((p, n) => {
      const quien = agenteDe(p)
      vistas.push([quien, ...p.herramientas.map((h) => String((h as { name: string }).name))])
      if (quien === 'general' && n === 0) return pide(llamada('preguntar_a_ventas', { pregunta: 'x' }))
      if (quien === 'ventas' && n === 1) return pide(llamada('preguntar_a_catalogo', { pregunta: 'y' }))
      return contesta('listo')
    })
    const entorno: Entorno = { modelo, ejecutar: () => Promise.resolve('') }

    await responder(entorno, preguntar('algo'))

    const catalogo = vistas.find((v) => v[0] === 'catalogo')
    expect(catalogo, 'el catálogo tiene que haber corrido').toBeTruthy()
    // Catálogo no puede volver a Ventas: Ventas está en la pila.
    expect(catalogo!.some((n) => n.startsWith('preguntar_a_'))).toBe(false)
  })

  it('a la profundidad máxima ya no se ofrecen colegas', async () => {
    const vistas = new Map<string, string[]>()
    const { modelo } = modeloGuionado((p, n) => {
      const quien = agenteDe(p)
      if (!vistas.has(quien)) vistas.set(quien, p.herramientas.map((h) => String((h as { name: string }).name)))
      if (quien === 'general' && n === 0) return pide(llamada('preguntar_a_ventas', { pregunta: 'x' }))
      if (quien === 'ventas' && n === 1) return pide(llamada('preguntar_a_catalogo', { pregunta: 'y' }))
      return contesta('listo')
    })
    const entorno: Entorno = { modelo, ejecutar: () => Promise.resolve(''), limites: { profundidad: 2 } }

    await responder(entorno, preguntar('algo'))
    // Con profundidad 2, Ventas (pila = [general]) todavía puede consultar;
    // Catálogo (pila = [general, ventas]) ya no.
    expect(vistas.get('catalogo')?.some((n) => n.startsWith('preguntar_a_'))).toBe(false)
  })

  /** Un agente que insiste con herramientas para siempre tiene que contestar igual. */
  it('corta las vueltas y pide una respuesta final con lo que haya', async () => {
    let cierres = 0
    const { modelo } = modeloGuionado((p) => {
      if (p.herramientas.length === 0) {
        cierres++
        return contesta('Con lo que junté: no lo encontré.')
      }
      return pide(llamada('buscar_productos', { texto: 'x' }))
    })
    const entorno: Entorno = {
      modelo,
      ejecutar: () => Promise.resolve('sin resultados'),
      limites: { vueltasPorAgente: 3 },
    }

    const r = await responder(entorno, preguntar('buscá algo'), 'catalogo')
    expect(r.corte).toBe('vueltas')
    expect(cierres, 'el cierre se pide SIN herramientas').toBe(1)
    expect(r.texto).toContain('no lo encontré')
    expect(r.pasos).toHaveLength(3)
  })

  it('el presupuesto global topea el gasto aunque las vueltas alcancen', async () => {
    const { modelo } = modeloGuionado((p) =>
      p.herramientas.length === 0 ? contesta('fin') : pide(llamada('preguntar_a_catalogo', { pregunta: 'x' })),
    )
    const entorno: Entorno = {
      modelo,
      ejecutar: () => Promise.resolve(''),
      limites: { llamadasAlModelo: 4, vueltasPorAgente: 50, profundidad: 9 },
    }

    const r = await responder(entorno, preguntar('algo'))
    expect(r.llamadas).toBeLessThanOrEqual(4)
    expect(r.corte).toBe('presupuesto')
    // Termina en una RESPUESTA, no en una excepción.
    expect(r.texto.length).toBeGreaterThan(0)
  })
})

describe('El bucle · cuando algo sale mal', () => {
  /**
   * La web vieja se tragaba los errores de herramienta en un `catch` vacío, y
   * el agente seguía como si nada con un dato que nunca llegó. Acá el fallo
   * vuelve COMO TEXTO al modelo, que puede reintentar de otra forma.
   */
  it('un fallo de herramienta vuelve al modelo como texto y se puede reintentar', async () => {
    const recibido: string[] = []
    const { modelo } = modeloGuionado((p, n) => {
      for (const m of p.mensajes) if (m.rol === 'herramienta') recibido.push(m.texto)
      if (n === 0) return pide(llamada('buscar_cliente', { texto: 'Mirgorr' }))
      if (n === 1) return pide(llamada('buscar_cliente', { texto: 'Mirgor' }))
      return contesta('Es Mirgor S.A.')
    })
    const entorno: Entorno = {
      modelo,
      ejecutar: (_n, args) =>
        Promise.resolve(
          args['texto'] === 'Mirgor' ? 'Mirgor S.A.' : 'No encontré ningún cliente con ese texto.',
        ),
    }

    const r = await responder(entorno, preguntar('¿qué le vendimos a Mirgorr?'), 'ventas')
    expect(recibido).toContain('No encontré ningún cliente con ese texto.')
    expect(r.texto).toBe('Es Mirgor S.A.')
  })

  it('una consulta sin pregunta se le devuelve al modelo en vez de romper', async () => {
    const { modelo } = modeloGuionado((p, n) => {
      if (agenteDe(p) === 'general' && n === 0) return pide(llamada('preguntar_a_catalogo', {}))
      return contesta('Perdón, ¿qué producto?')
    })
    const entorno: Entorno = { modelo, ejecutar: () => Promise.resolve('') }

    const r = await responder(entorno, preguntar('buscá eso'))
    expect(r.texto).toBe('Perdón, ¿qué producto?')
    expect(r.pasos[0]?.resumen).toContain('No me pasaste la pregunta')
  })

  it('un agente inicial que no existe no revienta', async () => {
    const entorno: Entorno = {
      modelo: () => Promise.reject(new Error('no se debería llamar')),
      ejecutar: () => Promise.resolve(''),
    }
    const r = await responder(entorno, preguntar('hola'), 'inexistente')
    expect(r.texto).toContain('No encuentro')
    expect(r.llamadas).toBe(0)
  })
})

describe('Lo que ve cada agente', () => {
  it('cada especialista ve sus herramientas y ninguna ajena', async () => {
    const vistas = new Map<string, string[]>()
    const { modelo } = modeloGuionado((p) => {
      vistas.set(agenteDe(p), p.herramientas.map((h) => String((h as { name: string }).name)))
      return contesta('ok')
    })
    const entorno: Entorno = { modelo, ejecutar: () => Promise.resolve('') }

    for (const a of todosLosAgentes()) await responder(entorno, preguntar('x'), a.id)

    for (const a of todosLosAgentes()) {
      const vistas_ = vistas.get(a.id) ?? []
      const propias = vistas_.filter((n) => !n.startsWith('preguntar_a_'))
      expect(propias.sort(), a.id).toEqual([...a.herramientas].sort())
      // Y que la descripción que lee el modelo sea la de la herramienta.
      for (const id of a.herramientas) expect(herramienta(id)).not.toBeNull()
    }
  })

  /** El de correo es el único que ve la bandeja: fue el error clásico del legacy. */
  it('sólo el agente de correo puede buscar emails', () => {
    const conEmails = todosLosAgentes().filter((a) => a.herramientas.includes('buscar_emails'))
    expect(conEmails.map((a) => a.id)).toEqual(['emails'])
  })
})
