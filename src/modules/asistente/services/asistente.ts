import { supabase } from '@/services/supabase/client'

/**
 * El asistente: la única puerta desde el navegador (Fase 31 · E4).
 *
 * Acá no hay lógica de agentes, ni prompts, ni claves. Todo eso vive en la
 * Edge Function, y es a propósito: en la web vieja las claves de OpenAI y
 * Anthropic se guardaban en `localStorage` y el token del proxy estaba escrito
 * en el JavaScript público. Desde este lado sólo se manda la conversación.
 */

/** Un mensaje de la charla. Los dos únicos roles que viajan. */
export interface MensajeChat {
  rol: 'usuario' | 'agente'
  texto: string
}

/** Un paso de lo que hizo el asistente, para poder mostrarlo. */
export interface PasoAsistente {
  agente: string
  tipo: 'herramienta' | 'consulta'
  nombre: string
}

/** Un renglón del borrador que armó el asistente. */
export interface LineaPropuesta {
  n: number
  /** Lo que pidió la persona, tal cual. */
  pidio: string
  cantidad: number
  resuelto: boolean
  productId?: string
  sku?: string
  nombre?: string
  precio?: number
  /** «último a este cliente» o «lista». No es lo mismo para quien revisa. */
  origenPrecio?: string
  disponible?: number
  /** Por qué no se pudo resolver. */
  nota?: string
}

/**
 * El borrador de cotización que armó el asistente.
 *
 * Viaja ESTRUCTURADO, aparte del texto: la pantalla no lo saca de la prosa del
 * modelo. Y nada de esto está creado todavía — se crea con el botón.
 */
export interface PropuestaCotizacion {
  listoParaConfirmar: boolean
  clienteId: string
  clienteNombre: string
  moneda: string
  lineas: LineaPropuesta[]
  sinResolver: number
  total: number
}

/**
 * Un producto que el asistente nombró en su respuesta (Fase 40).
 *
 * Viaja ESTRUCTURADO por el mismo canal que el borrador, no sacado del texto:
 * la pantalla dibuja una tarjeta con sus botones y no tiene que adivinar dónde
 * terminaba el SKU dentro de una frase.
 *
 * No trae el id del producto, a propósito: «Ver» va a `/catalogo/:sku`, que no
 * lo necesita, y para «Agregar» se resuelve el id de todos los SKU juntos en
 * una sola consulta. Mandar el uuid de cada producto a través del modelo sería
 * pagar tokens por un dato que la pantalla puede averiguar sola.
 */
export interface ProductoNombrado {
  sku: string
  nombre: string
  precio: number | null
  moneda: string | null
  disponible: number | null
}

export interface RespuestaAsistente {
  texto: string
  pasos: PasoAsistente[]
  /** Cuántas veces se llamó al modelo. Es lo que costó la consulta. */
  llamadas: number
  /** Si se tocó un tope, cuál. */
  corte: 'ninguno' | 'vueltas' | 'presupuesto'
  /** El borrador, si el asistente armó uno en esta vuelta. */
  propuesta: PropuestaCotizacion | null
  /** Los productos que nombró, para las tarjetas. Vacío si no nombró ninguno. */
  productos: ProductoNombrado[]
}

export interface AgenteDisponible {
  id: string
  titulo: string
  paraQue: string
}

export interface EstadoAsistente {
  proveedor: string
  /** `false` cuando está desplegado pero sin proveedor real configurado. */
  listo: boolean
  agentes: AgenteDisponible[]
}

export class FalloAsistente extends Error {
  constructor(
    readonly motivo: string,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'FalloAsistente'
  }
}

const cadena = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Número, comprobando el tipo. La base manda los importes como texto. */
const numero = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * El motivo y el mensaje vienen en el CUERPO, no en el error.
 *
 * `functions.invoke` trata cualquier respuesta no-2xx como un fallo y deja el
 * `Response` en `error.context`; su `.message` es genérico. Sin leer el
 * cuerpo, «Se alcanzó el límite del proveedor» se vería como «Edge Function
 * returned a non-2xx status code», que no ayuda a nadie.
 */
async function fallo(error: Error): Promise<never> {
  const ctx = (error as { context?: unknown }).context
  if (ctx instanceof Response) {
    const cuerpo: unknown = await ctx.json().catch(() => null)
    const e = (cuerpo as { error?: { motivo?: unknown; mensaje?: unknown } } | null)?.error
    if (typeof e?.mensaje === 'string') {
      throw new FalloAsistente(typeof e.motivo === 'string' ? e.motivo : 'error', e.mensaje)
    }
    if (ctx.status === 404) {
      throw new FalloAsistente(
        'sin_desplegar',
        'El asistente todavía no está disponible: falta desplegar su función.',
      )
    }
  }
  throw new FalloAsistente('error', `No pude consultar al asistente: ${error.message}`)
}

/**
 * Preguntarle al asistente.
 *
 * Se manda la conversación entera y no sólo el último mensaje: los agentes no
 * guardan estado entre llamadas, así que el hilo ES el contexto. La función
 * recorta a los últimos mensajes del lado del servidor.
 */
export async function preguntar(params: {
  companyId: string
  mensajes: readonly MensajeChat[]
  /** Con cuál arrancar. Vacío: el general, que deriva. */
  agente?: string | null
}): Promise<RespuestaAsistente> {
  const r: { data: unknown; error: Error | null } = await supabase.functions.invoke<unknown>(
    'asistente',
    {
      body: {
        companyId: params.companyId,
        mensajes: params.mensajes,
        agente: params.agente ?? null,
      },
    },
  )
  if (r.error) await fallo(r.error)

  const o = (r.data ?? {}) as Record<string, unknown>
  const pasos = Array.isArray(o['pasos']) ? o['pasos'] : []
  return {
    texto: cadena(o['texto']),
    pasos: pasos.map((p) => {
      const x = (p ?? {}) as Record<string, unknown>
      return {
        agente: cadena(x['agente']),
        tipo: x['tipo'] === 'consulta' ? 'consulta' : 'herramienta',
        nombre: cadena(x['nombre']),
      }
    }),
    llamadas: typeof o['llamadas'] === 'number' ? o['llamadas'] : 0,
    corte: o['corte'] === 'vueltas' || o['corte'] === 'presupuesto' ? o['corte'] : 'ninguno',
    propuesta: leerPropuesta(o['propuesta']),
    productos: leerProductos(o['productos']),
  }
}

/**
 * Los productos nombrados, comprobando los tipos en vez de confiar.
 *
 * Una fila sin SKU se descarta: el SKU es la identidad y sin él la tarjeta no
 * puede ni enlazar ni agregar. Es preferible mostrar una tarjeta menos que una
 * que no hace nada.
 */
function leerProductos(v: unknown): ProductoNombrado[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((p) => {
    if (typeof p !== 'object' || p === null) return []
    const o = p as Record<string, unknown>
    const sku = cadena(o['sku'])
    if (sku === '') return []
    const num = (x: unknown): number | null => {
      if (x === null || x === undefined) return null
      const n = Number(x)
      return Number.isFinite(n) ? n : null
    }
    return [{
      sku,
      nombre: cadena(o['nombre']) || sku,
      precio: num(o['precio']),
      moneda: cadena(o['moneda']) || null,
      disponible: num(o['disponible']),
    }]
  })
}

/**
 * El borrador, comprobando los tipos en vez de confiar.
 *
 * La forma viene de la base a través de la función, así que es conocida; se
 * valida igual porque lo que se hace con esto es CREAR una cotización, y un
 * campo mal leído ahí no da un cartel feo: da un documento equivocado.
 */
function leerPropuesta(v: unknown): PropuestaCotizacion | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const cli = (typeof o['cliente'] === 'object' && o['cliente'] !== null
    ? o['cliente']
    : {}) as Record<string, unknown>
  const clienteId = cadena(cli['id'])
  if (clienteId === '') return null

  const lineas = Array.isArray(o['lineas']) ? o['lineas'] : []
  return {
    listoParaConfirmar: o['listo_para_confirmar'] === true,
    clienteId,
    clienteNombre: cadena(cli['nombre']),
    moneda: cadena(o['moneda']) || 'USD',
    sinResolver: numero(o['sin_resolver']),
    total: numero(o['total']),
    lineas: lineas.map((l): LineaPropuesta => {
      const x = (l ?? {}) as Record<string, unknown>
      const base = {
        n: numero(x['n']),
        pidio: cadena(x['pidio']),
        cantidad: numero(x['cantidad']),
        resuelto: x['resuelto'] === true,
      }
      return x['resuelto'] === true
        ? {
            ...base,
            productId: cadena(x['product_id']),
            sku: cadena(x['sku']),
            nombre: cadena(x['nombre']),
            precio: numero(x['precio']),
            origenPrecio: cadena(x['origen_precio']),
            disponible: numero(x['disponible']),
          }
        : { ...base, nota: cadena(x['nota']) }
    }),
  }
}

/** Un documento adjuntado, ya pasado a texto. */
export interface Adjunto {
  nombre: string
  paginas: number | null
  /** `true` si el documento era más largo que lo que entra en una consulta. */
  recortado: boolean
  texto: string
}

/**
 * Sacarle el texto a un PDF para poder preguntar SOBRE él (Fase 36 · E3).
 *
 * El archivo no se guarda en ningún lado: se lee, se devuelve el texto y se
 * termina. Lo que después viaja al asistente es ese texto dentro de la
 * pregunta, así que los agentes no se enteran de que hubo un adjunto — para
 * ellos es una consulta más larga.
 *
 * Eso tiene una consecuencia buena: no hubo que tocar el bucle de agentes ni
 * las herramientas. Y una limitación honesta: si el PDF es una foto escaneada,
 * no hay texto que sacar y se dice.
 */
export async function leerAdjunto(archivo: File): Promise<Adjunto> {
  const cuerpo = new FormData()
  cuerpo.append('archivo', archivo)

  const r: { data: unknown; error: Error | null } = await supabase.functions.invoke<unknown>(
    'asistente',
    { body: cuerpo },
  )
  if (r.error) await fallo(r.error)

  const o = (r.data ?? {}) as Record<string, unknown>
  return {
    nombre: cadena(o['nombre']) || archivo.name,
    paginas: typeof o['paginas'] === 'number' ? o['paginas'] : null,
    recortado: o['recortado'] === true,
    texto: cadena(o['texto']),
  }
}

/**
 * Pasar un audio a texto (Fase 36 · E2).
 *
 * Lo transcripto vuelve al cuadro de texto y NO se manda solo. La
 * transcripción se equivoca con los SKU —«SP punto dos mil ocho» sale de diez
 * maneras— y una consulta armada sobre una referencia mal oída devuelve el
 * producto equivocado con total aplomo. Leerlo antes de enviar cuesta un
 * segundo.
 */
export async function transcribir(audio: Blob): Promise<string> {
  const cuerpo = new FormData()
  cuerpo.append('audio', audio, 'consulta.webm')

  const r: { data: unknown; error: Error | null } = await supabase.functions.invoke<unknown>(
    'asistente',
    { body: cuerpo },
  )
  if (r.error) await fallo(r.error)

  const o = (r.data ?? {}) as Record<string, unknown>
  return cadena(o['texto'])
}

/**
 * En qué estado está el asistente.
 *
 * Existe para que el cartel de la pantalla diga la verdad. Uno que anuncia
 * «IA activa» cuando el proveedor está en `falso` es peor que no tener
 * cartel: manda a probar y a no entender por qué contesta siempre lo mismo.
 *
 * Si la función no responde, se asume que NO está lista. Ante la duda, el
 * cartel se calla.
 */
export async function estadoAsistente(): Promise<EstadoAsistente> {
  try {
    const r: { data: unknown; error: Error | null } = await supabase.functions.invoke<unknown>(
      'asistente',
      { method: 'GET' },
    )
    if (r.error) return { proveedor: 'desconocido', listo: false, agentes: [] }
    const o = (r.data ?? {}) as Record<string, unknown>
    const agentes = Array.isArray(o['agentes']) ? o['agentes'] : []
    return {
      proveedor: cadena(o['proveedor']) || 'desconocido',
      listo: o['listo'] === true,
      agentes: agentes.map((a) => {
        const x = (a ?? {}) as Record<string, unknown>
        return { id: cadena(x['id']), titulo: cadena(x['titulo']), paraQue: cadena(x['paraQue']) }
      }),
    }
  } catch {
    return { proveedor: 'desconocido', listo: false, agentes: [] }
  }
}
