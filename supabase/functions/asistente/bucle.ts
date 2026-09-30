/**
 * El bucle de razonamiento (Fase 31 · E1). PURO.
 *
 * Un agente recibe una pregunta, decide si le alcanza con lo que sabe o si
 * necesita una herramienta, la usa, mira el resultado y vuelve a decidir.
 * Cuando termina, contesta. Si en el medio necesita a un colega, lo consulta
 * —y el colega corre exactamente este mismo bucle—.
 *
 * Acá no hay red, ni proveedor, ni base de datos: entran dos funciones
 * (`modelo` y `ejecutar`) y todo lo demás es decisión. Por eso se puede probar
 * entero con un modelo de mentira que devuelve llamadas fijas, que es la única
 * forma de verificar que los límites y los ciclos funcionan sin gastar dinero
 * ni depender de que el modelo real se porte igual dos veces seguidas.
 *
 * ── Los límites no son una optimización ─────────────────────────────────────
 *
 * Son lo que separa «un ejército de agentes» de «una cuenta de OpenAI
 * vaciándose sola». Tres agentes que se consultan en círculo no dan error: dan
 * una espera infinita y una factura. Todos los cortes de acá terminan en una
 * RESPUESTA, nunca en una excepción hacia la persona: un agente que se quedó
 * sin presupuesto igual tiene algo que decir, y decir a medias es mejor que
 * romperse.
 */
import { AGENTE_RAIZ, PROMPT_COMUN, agente, agenteDeConsulta, nombreDeConsulta } from './agentes.ts'
import { esquemaParaModelo, herramienta } from './herramientas.ts'

export interface LlamadaHerramienta {
  /** El identificador que el proveedor usa para aparear la respuesta. */
  id: string
  nombre: string
  argumentos: Record<string, unknown>
}

export type Mensaje =
  | { rol: 'usuario'; texto: string }
  | {
      rol: 'agente'
      texto: string
      llamadas?: readonly LlamadaHerramienta[]
      /**
       * Lo que devolvió el proveedor, tal cual, para devolvérselo después.
       *
       * El bucle no lo mira ni sabe qué hay adentro: sólo lo transporta. Los
       * modelos que razonan emiten bloques propios entre la pregunta y la
       * llamada a herramienta, y si no vuelven junto con el resultado se
       * pierde el hilo del razonamiento —y según el proveedor, la
       * conversación entera se rechaza por quedar mal apareada—.
       *
       * Reconstruir los mensajes a mano en vez de reenviar esto funcionaba en
       * las pruebas con modelo guionado y se habría roto en la primera
       * consulta real.
       */
      crudo?: readonly unknown[]
    }
  | { rol: 'herramienta'; id: string; nombre: string; texto: string }

export interface PedidoAlModelo {
  sistema: string
  mensajes: readonly Mensaje[]
  herramientas: readonly Record<string, unknown>[]
}

export interface RespuestaModelo {
  texto: string
  llamadas: readonly LlamadaHerramienta[]
  /** Los ítems del proveedor, para reenviarlos en la vuelta siguiente. */
  crudo?: readonly unknown[]
}

export interface Limites {
  /** Cuántos agentes pueden estar encadenados. 3 = general → ventas → catálogo. */
  profundidad: number
  /** Cuántas vueltas de herramienta puede dar UN agente antes de tener que contestar. */
  vueltasPorAgente: number
  /** Cuántas veces se puede llamar al modelo en toda la consulta. El techo del gasto. */
  llamadasAlModelo: number
}

export const LIMITES: Limites = {
  profundidad: 3,
  vueltasPorAgente: 6,
  llamadasAlModelo: 24,
}

export interface Entorno {
  modelo(pedido: PedidoAlModelo): Promise<RespuestaModelo>
  /**
   * Ejecuta una herramienta y devuelve TEXTO para el modelo.
   *
   * Nunca lanza: un fallo se devuelve como texto que explica qué pasó. Que el
   * modelo pueda leer «no encontré ese cliente» y reintentar con otro nombre
   * es la diferencia entre un asistente que se recupera y uno que se disculpa.
   * La web vieja se tragaba estos errores en un `catch` vacío.
   */
  ejecutar(nombre: string, argumentos: Record<string, unknown>): Promise<string>
  /**
   * Lo que el agente tiene que saber de ESTA consulta: la fecha de hoy y
   * quién pregunta. Se inyecta porque este módulo es puro y no puede mirar
   * el reloj —y porque en un test la fecha tiene que poder ser fija—.
   *
   * Sin esto, «el mejor cliente de agosto» se contestaba preguntando de qué
   * año. Tenía razón el modelo: no lo podía saber.
   */
  contexto?: string
  limites?: Partial<Limites>
}

/** Un paso de lo que pasó, para poder mostrarlo y para poder depurarlo. */
export interface Paso {
  agente: string
  /** `herramienta` o `consulta`. */
  tipo: 'herramienta' | 'consulta'
  nombre: string
  argumentos: Record<string, unknown>
  /** Recortado: la traza se muestra, no se lee entera. */
  resumen: string
}

export interface Resultado {
  texto: string
  pasos: readonly Paso[]
  /** Cuántas veces se llamó al modelo. Es el costo de la consulta. */
  llamadas: number
  /** Qué corte se tocó, si se tocó alguno. Para poder verlo en la pantalla. */
  corte: 'ninguno' | 'vueltas' | 'presupuesto'
}

const RESUMEN_MAX = 300

const recortar = (s: string): string =>
  s.length <= RESUMEN_MAX ? s : `${s.slice(0, RESUMEN_MAX)}… (+${s.length - RESUMEN_MAX})`

/** Lo mutable de una consulta: el presupuesto y la traza. */
interface Cuenta {
  llamadas: number
  pasos: Paso[]
  corte: 'ninguno' | 'vueltas' | 'presupuesto'
}

/**
 * Las herramientas que ve un agente: las suyas, más una por colega disponible.
 *
 * Un colega que ya está en la pila NO aparece. Es lo que corta los ciclos, y
 * se hace quitándole la opción al modelo en vez de dejándolo llamar y
 * rechazarlo después: un modelo al que se le rechaza una herramienta que ve
 * disponible la vuelve a intentar, y se gastan vueltas en eso.
 */
function herramientasVisibles(agenteId: string, pila: readonly string[], limites: Limites) {
  const a = agente(agenteId)
  if (!a) return []

  const propias = a.herramientas
    .map((id) => herramienta(id))
    .filter((h): h is NonNullable<typeof h> => h !== null)
    .map(esquemaParaModelo)

  if (pila.length >= limites.profundidad) return propias

  const colegas = a.consulta
    .filter((id) => !pila.includes(id))
    .map((id) => {
      const c = agente(id)
      if (!c) return null
      return {
        type: 'function',
        name: nombreDeConsulta(id),
        description: `Consultale a ${c.titulo}. ${c.paraQue}`,
        parameters: {
          type: 'object',
          properties: {
            pregunta: {
              type: 'string',
              description:
                'La pregunta COMPLETA y con todo el contexto que necesite. El colega no ve ' +
                'esta conversación: si la persona dijo «y de ese cliente?», acá va el nombre.',
            },
          },
          required: ['pregunta'],
          additionalProperties: false,
        },
      } as Record<string, unknown>
    })
    .filter((x): x is Record<string, unknown> => x !== null)

  return [...propias, ...colegas]
}

/**
 * El prompt de sistema: lo común, lo del agente, y el contexto de la consulta.
 *
 * El contexto va al final y no al principio: es lo más específico y lo que no
 * se puede deducir de nada —la fecha de hoy, quién pregunta—, y conviene que
 * quede cerca de la pregunta.
 */
function sistemaDe(agenteId: string, contexto: string | undefined): string {
  const a = agente(agenteId)
  const base = a ? `${PROMPT_COMUN}\n\n---\n\n${a.prompt}` : PROMPT_COMUN
  return contexto ? `${base}\n\n---\n\n${contexto}` : base
}

/**
 * Corre UN agente hasta que conteste o se quede sin vueltas.
 *
 * `pila` son los agentes que ya están corriendo por encima de éste; sirve para
 * la profundidad y para que nadie se consulte en círculo.
 */
async function correr(
  entorno: Entorno,
  limites: Limites,
  cuenta: Cuenta,
  agenteId: string,
  historial: readonly Mensaje[],
  pila: readonly string[],
): Promise<string> {
  const mensajes: Mensaje[] = [...historial]
  const herramientas = herramientasVisibles(agenteId, pila, limites)

  for (let vuelta = 0; vuelta < limites.vueltasPorAgente; vuelta++) {
    if (cuenta.llamadas >= limites.llamadasAlModelo) {
      cuenta.corte = 'presupuesto'
      return textoDeCorte(agenteId, cuenta)
    }

    cuenta.llamadas++
    const r = await entorno.modelo({ sistema: sistemaDe(agenteId, entorno.contexto), mensajes, herramientas })

    // Sin llamadas, contestó: se termina.
    if (r.llamadas.length === 0) return r.texto

    mensajes.push({ rol: 'agente', texto: r.texto, llamadas: r.llamadas, crudo: r.crudo })

    /**
     * Las llamadas de una misma vuelta van EN PARALELO.
     *
     * Es lo que hace que «¿qué le cotizamos a Mirgor y hay stock?» cueste una
     * espera y no dos: el modelo pide las dos consultas juntas y las dos
     * salen juntas. En serie, una cadena de tres agentes se siente lenta aun
     * cuando cada eslabón es rápido.
     */
    const resultados = await Promise.all(
      r.llamadas.map((ll) => atender(entorno, limites, cuenta, agenteId, ll, pila)),
    )
    for (const m of resultados) mensajes.push(m)
  }

  // Se quedó sin vueltas. Se le pide que conteste con lo que juntó, sin
  // herramientas: es la forma de que el corte termine en una respuesta útil y
  // no en «se acabaron los intentos».
  cuenta.corte = 'vueltas'
  if (cuenta.llamadas >= limites.llamadasAlModelo) return textoDeCorte(agenteId, cuenta)

  cuenta.llamadas++
  const cierre = await entorno.modelo({
    sistema: sistemaDe(agenteId, entorno.contexto),
    mensajes: [
      ...mensajes,
      {
        rol: 'usuario',
        texto:
          'Contestá ahora con lo que ya averiguaste, sin buscar más. ' +
          'Si te quedó algo sin resolver, decí qué falta.',
      },
    ],
    herramientas: [],
  })
  return cierre.texto
}

/** Una llamada: o es una consulta a un colega, o es una herramienta de datos. */
async function atender(
  entorno: Entorno,
  limites: Limites,
  cuenta: Cuenta,
  agenteId: string,
  ll: LlamadaHerramienta,
  pila: readonly string[],
): Promise<Mensaje> {
  const colega = agenteDeConsulta(ll.nombre)

  if (colega !== null) {
    const pregunta = typeof ll.argumentos['pregunta'] === 'string' ? ll.argumentos['pregunta'] : ''
    /**
     * El paso se anota ANTES de correr al colega, y se completa después.
     *
     * Si se anotara al final, la traza saldría al revés —la herramienta que
     * usó el colega aparecería antes que la derivación que la provocó—, y la
     * traza está para mostrar en qué anda el asistente mientras trabaja: en
     * ese orden no se entiende.
     */
    const paso: Paso = {
      agente: agenteId,
      tipo: 'consulta',
      nombre: colega,
      argumentos: { pregunta },
      resumen: '',
    }
    cuenta.pasos.push(paso)

    let texto: string
    if (pregunta.trim() === '') {
      texto = 'No me pasaste la pregunta. Volvé a llamarme con el texto completo.'
    } else if (pila.includes(colega)) {
      // No debería pasar —la herramienta no está visible—, pero si el modelo
      // la inventa, se contesta y se sigue en vez de romper.
      texto = `Ya estás dentro de una consulta a ${colega}. Contestá con lo que tengas.`
    } else {
      texto = await correr(entorno, limites, cuenta, colega, [{ rol: 'usuario', texto: pregunta }], [
        ...pila,
        agenteId,
      ])
    }
    paso.resumen = recortar(texto)
    return { rol: 'herramienta', id: ll.id, nombre: ll.nombre, texto }
  }

  const texto = await entorno.ejecutar(ll.nombre, ll.argumentos)
  cuenta.pasos.push({
    agente: agenteId,
    tipo: 'herramienta',
    nombre: ll.nombre,
    argumentos: ll.argumentos,
    resumen: recortar(texto),
  })
  return { rol: 'herramienta', id: ll.id, nombre: ll.nombre, texto }
}

function textoDeCorte(agenteId: string, cuenta: Cuenta): string {
  const hechos = cuenta.pasos.filter((p) => p.agente === agenteId).length
  return hechos > 0
    ? 'La consulta se hizo demasiado larga y la corté. Probá preguntándome algo más acotado.'
    : 'No llegué a averiguarlo: la consulta se hizo demasiado larga. Probá con algo más puntual.'
}

/** El punto de entrada: le pregunta al agente raíz y devuelve lo que salga. */
export async function responder(
  entorno: Entorno,
  historial: readonly Mensaje[],
  agenteInicial: string = AGENTE_RAIZ,
): Promise<Resultado> {
  const limites = { ...LIMITES, ...(entorno.limites ?? {}) }
  const cuenta: Cuenta = { llamadas: 0, pasos: [], corte: 'ninguno' }

  if (!agente(agenteInicial)) {
    return {
      texto: 'No encuentro ese asistente.',
      pasos: [],
      llamadas: 0,
      corte: 'ninguno',
    }
  }

  const texto = await correr(entorno, limites, cuenta, agenteInicial, historial, [])
  return { texto, pasos: cuenta.pasos, llamadas: cuenta.llamadas, corte: cuenta.corte }
}
