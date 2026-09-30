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

export interface RespuestaAsistente {
  texto: string
  pasos: PasoAsistente[]
  /** Cuántas veces se llamó al modelo. Es lo que costó la consulta. */
  llamadas: number
  /** Si se tocó un tope, cuál. */
  corte: 'ninguno' | 'vueltas' | 'presupuesto'
  /** El borrador, si el asistente armó uno en esta vuelta. */
  propuesta: PropuestaCotizacion | null
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
  }
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
