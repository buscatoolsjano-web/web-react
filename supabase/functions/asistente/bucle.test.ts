import { describe, expect, it } from 'vitest'
import { agente, AGENTE_RAIZ, nombreDeConsulta, revisarRegistro, todosLosAgentes } from './agentes.ts'
import { HERRAMIENTAS, esquemaParaModelo, herramienta } from './herramientas.ts'
import {
  type Entorno,
  type EventoDelBucle,
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

  /*
   * La lista que pone la PUERTA (Fase 85).
   *
   * Cata contesta con el agente de Catálogo y además necesita el último
   * costo, que es de Compras. Sin esto habría que agregárselo a `agentes.ts`,
   * y entonces lo tendrían también el asistente escrito y la API.
   */
  it('una puerta puede ofrecer otras herramientas en lugar de las del agente', async () => {
    let vistas: string[] = []
    const { modelo } = modeloGuionado((p) => {
      vistas = p.herramientas.map((h) => String((h as { name: string }).name))
      return contesta('ok')
    })
    const entorno: Entorno = {
      modelo,
      ejecutar: () => Promise.resolve(''),
      herramientas: ['buscar_productos', 'ultimo_costo'],
    }

    await responder(entorno, preguntar('¿a cuánto compramos la PH2?'), 'catalogo')

    expect(vistas.sort()).toEqual(['buscar_productos', 'ultimo_costo'])
  })

  it('sin esa lista, el agente sigue viendo exactamente las suyas', async () => {
    // Es lo que protege al asistente escrito: la prop es opcional y ausente
    // no cambia nada.
    let vistas: string[] = []
    const { modelo } = modeloGuionado((p) => {
      vistas = p.herramientas.map((h) => String((h as { name: string }).name))
      return contesta('ok')
    })

    await responder({ modelo, ejecutar: () => Promise.resolve('') }, preguntar('x'), 'catalogo')

    expect(vistas.sort()).toEqual([...(agente('catalogo')?.herramientas ?? [])].sort())
  })
})

/*
 * ── EL ATAJO DEL DERIVADOR (Fase 64) ────────────────────────────────────────
 *
 * Medido en producción: una consulta tardaba 28.674 ms. Para «dame puntas
 * PH2» eran CUATRO llamadas al modelo y la cuarta sólo reescribía con otras
 * palabras lo que ya había contestado Catálogo, porque el general no tiene
 * herramientas de datos: no puede agregar nada que no le haya dicho el colega.
 */
describe('El atajo del derivador', () => {
  it('una sola derivación se devuelve tal cual: no se paga una llamada para reescribirla', async () => {
    const { modelo, pedidos } = modeloGuionado((p, n) => {
      if (agenteDe(p) === AGENTE_RAIZ) return pide(llamada(nombreDeConsulta('catalogo'), { pregunta: 'puntas PH2' }))
      return n === 1 ? pide(llamada('buscar_productos', { texto: 'PH2' })) : contesta('Hay tres: SP.PH2, BR.PH2 y NO.PH2X50.')
    })
    const entorno: Entorno = { modelo, ejecutar: () => Promise.resolve('3 resultados') }

    const r = await responder(entorno, preguntar('dame puntas PH2'))

    expect(r.texto).toBe('Hay tres: SP.PH2, BR.PH2 y NO.PH2X50.')
    // TRES llamadas y no cuatro: general deriva · catálogo busca · catálogo
    // contesta. La que se ahorra es la del general reescribiendo.
    expect(r.llamadas).toBe(3)
    expect(pedidos.filter((p) => agenteDe(p) === AGENTE_RAIZ)).toHaveLength(1)
  })

  /* La traza NO se pierde: se sigue viendo que se consultó a Catálogo. */
  it('el atajo no se come la traza', async () => {
    const { modelo } = modeloGuionado((p) =>
      agenteDe(p) === AGENTE_RAIZ
        ? pide(llamada(nombreDeConsulta('catalogo'), { pregunta: 'puntas PH2' }))
        : contesta('Hay tres.'),
    )
    const r = await responder({ modelo, ejecutar: () => Promise.resolve('') }, preguntar('puntas'))

    expect(r.pasos.map((p) => p.nombre)).toContain('catalogo')
  })

  /*
   * CON DOS COLEGAS NO HAY ATAJO. «¿Qué le cotizamos a Mirgor y hay stock?»
   * necesita unir dos respuestas en una, y unir sí es trabajo: ahí la llamada
   * del general se gana su lugar.
   */
  it('dos derivaciones a la vez SÍ se unen: eso no es reescribir', async () => {
    const { modelo } = modeloGuionado((p, n) => {
      if (agenteDe(p) === AGENTE_RAIZ) {
        return n === 0
          ? pide(
              llamada(nombreDeConsulta('ventas'), { pregunta: 'qué le cotizamos a Mirgor' }),
              llamada(nombreDeConsulta('catalogo'), { pregunta: 'hay stock de eso' }),
            )
          : contesta('Le cotizamos USD 300 y quedan 40.')
      }
      return contesta('lo mío')
    })

    const r = await responder({ modelo, ejecutar: () => Promise.resolve('') }, preguntar('mirgor y stock'))

    expect(r.texto).toBe('Le cotizamos USD 300 y quedan 40.')
  })

  /*
   * UN ESPECIALISTA NO TOMA EL ATAJO aunque consulte a un colega: él sí tiene
   * herramientas, así que después de oír al colega todavía le queda decidir
   * qué hacer con eso. Devolver la respuesta del colega tal cual le sacaría
   * justamente la conclusión.
   */
  it('un agente con herramientas propias sigue cerrando él la respuesta', async () => {
    const { modelo } = modeloGuionado((p, n) => {
      if (agenteDe(p) === AGENTE_RAIZ) {
        return n === 0 ? pide(llamada(nombreDeConsulta('ventas'), { pregunta: 'y el stock?' })) : contesta('cierre del general')
      }
      if (agenteDe(p) === 'ventas') {
        return n === 1
          ? pide(llamada(nombreDeConsulta('catalogo'), { pregunta: 'stock de SP.PH2' }))
          : contesta('Ventas concluye: alcanza.')
      }
      return contesta('Catálogo dice: 40 disponibles.')
    })

    const r = await responder({ modelo, ejecutar: () => Promise.resolve('') }, preguntar('alcanza el stock?'))

    // Ventas NO devolvió «Catálogo dice: 40 disponibles» tal cual: sacó su
    // conclusión. Y el general, al ser una sola derivación, la pasó derecho.
    expect(r.texto).toBe('Ventas concluye: alcanza.')
  })

  /*
   * Si el general escribió algo ANTES de derivar, eso es suyo y se perdería:
   * ahí cierra él.
   */
  it('si el derivador dijo algo propio antes de derivar, no se atajá', async () => {
    const { modelo } = modeloGuionado((p, n) => {
      if (agenteDe(p) === AGENTE_RAIZ) {
        return n === 0
          ? { texto: 'Dale, fijate que esto va a tardar.', llamadas: [llamada(nombreDeConsulta('catalogo'), { pregunta: 'x' })] }
          : contesta('cierre con lo que dije antes')
      }
      return contesta('respuesta del colega')
    })

    const r = await responder({ modelo, ejecutar: () => Promise.resolve('') }, preguntar('x'))

    expect(r.texto).toBe('cierre con lo que dije antes')
  })
})

/*
 * El proveedor afina el pedido por agente —cuánto razonar—, así que el bucle
 * tiene que decirle cuál está preguntando. Sin esto el derivador razonaría
 * como un especialista y se pagarían segundos por elegir entre cinco colegas.
 */
describe('Cada pedido dice qué agente lo hace', () => {
  it('el agenteId viaja en el pedido al modelo', async () => {
    const { modelo, pedidos } = modeloGuionado((p, n) => {
      if (agenteDe(p) === AGENTE_RAIZ) return pide(llamada(nombreDeConsulta('catalogo'), { pregunta: 'x' }))
      return n === 1 ? contesta('ok') : contesta('ok')
    })
    await responder({ modelo, ejecutar: () => Promise.resolve('') }, preguntar('x'))

    expect(pedidos.map((p) => p.agenteId)).toEqual([AGENTE_RAIZ, 'catalogo'])
    // Y coincide con el prompt que se armó, que es la otra forma de saberlo.
    for (const p of pedidos) expect(p.agenteId).toBe(agenteDe(p))
  })
})

/*
 * ── LO QUE VA PASANDO, MIENTRAS PASA (Fase 65) ──────────────────────────────
 *
 * El servidor contestaba de una sola vez al final: 21 segundos sin nada que
 * mostrar, tapados con una barra que avanzaba sola. Ahora el bucle cuenta lo
 * que hace, y la pantalla puede decir la verdad.
 */
describe('Los eventos del bucle', () => {
  const conEventos = (entorno: Entorno) => {
    const vistos: EventoDelBucle[] = []
    return { entorno: { ...entorno, emitir: (e: EventoDelBucle) => vistos.push(e) }, vistos }
  }

  it('avisa cada derivación y cada herramienta ANTES de esperarlas', async () => {
    const orden: string[] = []
    const { modelo } = modeloGuionado((p, n) => {
      if (agenteDe(p) === AGENTE_RAIZ) return pide(llamada(nombreDeConsulta('catalogo'), { pregunta: 'PH2' }))
      return n === 1 ? pide(llamada('buscar_productos', { texto: 'PH2' })) : contesta('Hay tres.')
    })
    const { entorno, vistos } = conEventos({
      modelo,
      ejecutar: () => {
        orden.push('se ejecutó la herramienta')
        return Promise.resolve('3 resultados')
      },
    })

    await responder(entorno, preguntar('puntas PH2'))

    const pasos = vistos.filter((e) => e.tipo === 'paso')
    expect(pasos).toEqual([
      { tipo: 'paso', agente: 'general', clase: 'consulta', nombre: 'catalogo' },
      { tipo: 'paso', agente: 'catalogo', clase: 'herramienta', nombre: 'buscar_productos' },
    ])
    // El aviso llega ANTES de ejecutar, que es cuando empieza la espera. Al
    // revés, la pantalla contaría cada paso recién cuando ya terminó, que es
    // justo el rato en que no hace falta.
    expect(orden).toEqual(['se ejecutó la herramienta'])
  })

  /*
   * `turno` es lo que impide que la pantalla mienta: un agente que empieza a
   * escribir y después decide usar una herramienta dejaría medio párrafo
   * colgado que nunca fue la respuesta. El aviso le dice al cliente que
   * descarte lo que venía mostrando.
   */
  it('avisa cada turno nuevo, para que el cliente descarte lo anterior', async () => {
    const { modelo } = modeloGuionado((p, n) => {
      if (agenteDe(p) === AGENTE_RAIZ) return pide(llamada(nombreDeConsulta('catalogo'), { pregunta: 'x' }))
      return n === 1 ? pide(llamada('buscar_productos', { texto: 'x' })) : contesta('listo')
    })
    const { entorno, vistos } = conEventos({ modelo, ejecutar: () => Promise.resolve('') })

    await responder(entorno, preguntar('x'))

    expect(vistos.filter((e) => e.tipo === 'turno')).toEqual([
      { tipo: 'turno', agente: 'general' },
      { tipo: 'turno', agente: 'catalogo' },
      { tipo: 'turno', agente: 'catalogo' },
    ])
  })

  /* El `onTexto` viaja al proveedor sólo si hay alguien escuchando: sin eso
     el pedido tendría una función que nadie usa y el proveedor pediría el
     stream al cuete. */
  it('sin quien escuche, el pedido no lleva onTexto', async () => {
    const { modelo, pedidos } = modeloGuionado(() => contesta('ok'))
    await responder({ modelo, ejecutar: () => Promise.resolve('') }, preguntar('x'))
    expect(pedidos[0]?.onTexto).toBeUndefined()
  })

  it('con quien escuche, lo que el modelo escribe sale como deltas', async () => {
    const { modelo } = modeloGuionado((p) => {
      // El modelo de mentira «escribe» en pedazos, como el de verdad.
      for (const t of ['Hay ', 'tres ', 'puntas.']) p.onTexto?.(t)
      return contesta('Hay tres puntas.')
    })
    const { entorno, vistos } = conEventos({ modelo, ejecutar: () => Promise.resolve('') })

    const r = await responder(entorno, preguntar('puntas'))

    expect(vistos.filter((e) => e.tipo === 'delta').map((e) => (e as { texto: string }).texto))
      .toEqual(['Hay ', 'tres ', 'puntas.'])
    // Y el texto final sigue siendo el autoritativo, no la suma de deltas.
    expect(r.texto).toBe('Hay tres puntas.')
  })

  /*
   * QUIEN ESCUCHA NO PUEDE TUMBAR LA CONSULTA.
   *
   * Es un stream HTTP: la persona cierra el panel, se corta el wifi, y
   * escribir explota. Que eso cueste la respuesta entera —ya pagada en
   * llamadas al modelo— sería cambiar un problema de red por uno de plata.
   */
  it('si quien escucha explota, la consulta igual termina', async () => {
    const { modelo } = modeloGuionado((p) => {
      p.onTexto?.('algo')
      return contesta('la respuesta igual')
    })
    const r = await responder(
      {
        modelo,
        ejecutar: () => Promise.resolve(''),
        emitir: () => {
          throw new Error('el cliente se fue')
        },
      },
      preguntar('x'),
    )
    expect(r.texto).toBe('la respuesta igual')
  })
})
