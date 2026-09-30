/**
 * El proveedor de IA del asistente. SÓLO servidor (Deno) — Fase 31 · E3.
 *
 * La clave vive en los secrets de la Edge Function y no sale de acá: no se
 * devuelve, no se registra y no aparece en ningún mensaje de error.
 *
 *   IA_PROVIDER   = openai | falso        (default: falso)
 *   OPENAI_API_KEY = …
 *   IA_MODELO     = gpt-5.6-luna          (default)
 *   IA_ESFUERZO   = none | low | medium   (default: low)
 *
 * **El default es `falso` a propósito.** Una función desplegada sin configurar
 * no manda los datos de nadie a un tercero, y además deja probar la pantalla
 * entera —el chat, la traza, las derivaciones— sin gastar un peso.
 *
 * Es el mismo patrón que `importar-oc` y `whatsapp-ai-analyze`, y es
 * deliberado: la web vieja mandaba TODO a un Cloudflare Worker autenticado con
 * un token fijo escrito en el JavaScript público de un repositorio público.
 * Cualquiera que abriera el código podía gastar la cuenta de OpenAI.
 */
import OpenAI from 'npm:openai@7.17.0'
import type { LlamadaHerramienta, Mensaje, PedidoAlModelo, RespuestaModelo } from './bucle.ts'

const MODELO_POR_DEFECTO = 'gpt-5.6-luna'
const MODELOS = ['gpt-5.6-luna', 'gpt-5.6-terra'] as const
const ESFUERZOS = ['none', 'low', 'medium'] as const
const TIMEOUT_MS = 60_000
const REINTENTOS = 1
const MAX_OUTPUT_TOKENS = 4_000

export class FalloProveedor extends Error {
  constructor(
    readonly motivo: 'sin_configurar' | 'rechazo' | 'limite' | 'caido',
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'FalloProveedor'
  }
}

export interface Proveedor {
  nombre: string
  listo: boolean
  responder(pedido: PedidoAlModelo): Promise<RespuestaModelo>
}

/**
 * Los mensajes, en la forma que espera la API de respuestas.
 *
 * Cada llamada a herramienta viaja como un ítem propio, y su resultado como
 * otro apareado por `call_id`. Si se pierde el apareo, el proveedor rechaza la
 * conversación entera, así que el `id` que puso el proveedor se conserva tal
 * cual a lo largo del bucle en vez de generar uno nuestro.
 */
function aEntrada(mensajes: readonly Mensaje[]): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = []
  for (const m of mensajes) {
    if (m.rol === 'usuario') {
      items.push({ role: 'user', content: m.texto })
    } else if (m.rol === 'agente') {
      /**
       * Si tenemos lo que devolvió el proveedor, se le devuelve TAL CUAL.
       *
       * Reconstruirlo a mano parece equivalente y no lo es: un modelo que
       * razona emite bloques propios entre la pregunta y la llamada, y esos
       * bloques van apareados con lo que sigue. Rearmando los mensajes se
       * pierden, y la conversación puede volver rechazada por quedar mal
       * apareada. La reconstrucción de abajo queda sólo para los mensajes que
       * vienen del navegador, que nunca pasaron por el proveedor.
       */
      if (m.crudo && m.crudo.length > 0) {
        for (const item of m.crudo) items.push(item as Record<string, unknown>)
        continue
      }
      if (m.texto.trim() !== '') items.push({ role: 'assistant', content: m.texto })
      for (const ll of m.llamadas ?? []) {
        items.push({
          type: 'function_call',
          call_id: ll.id,
          name: ll.nombre,
          arguments: JSON.stringify(ll.argumentos),
        })
      }
    } else {
      items.push({ type: 'function_call_output', call_id: m.id, output: m.texto })
    }
  }
  return items
}

function clasificar(e: unknown): 'rechazo' | 'limite' | 'caido' {
  const status = (e as { status?: number } | null)?.status
  if (status === 401 || status === 403) return 'rechazo'
  if (status === 400 || status === 404 || status === 422) return 'rechazo'
  if (status === 429) return 'limite'
  return 'caido'
}

/**
 * Los argumentos de una llamada, que llegan como TEXTO y pueden venir rotos.
 *
 * Un JSON mal cerrado no puede tumbar la consulta: se devuelve un objeto
 * vacío, la herramienta se queja de que le faltan parámetros, y eso vuelve al
 * modelo como texto para que lo reintente. Es el mismo criterio que en el
 * resto: los fallos se convierten en algo que el modelo pueda leer.
 */
function argumentosDe(crudo: unknown): Record<string, unknown> {
  if (typeof crudo !== 'string' || crudo.trim() === '') return {}
  try {
    const v: unknown = JSON.parse(crudo)
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function proveedorOpenAI(cliente: OpenAI, modelo: string, esfuerzo: string): Proveedor {
  return {
    nombre: 'openai',
    listo: true,
    async responder(pedido: PedidoAlModelo): Promise<RespuestaModelo> {
      let respuesta: unknown
      try {
        respuesta = await cliente.responses.create({
          model: modelo,
          instructions: pedido.sistema,
          input: aEntrada(pedido.mensajes),
          tools: pedido.herramientas,
          reasoning: { effort: esfuerzo },
          max_output_tokens: MAX_OUTPUT_TOKENS,
          // Lo que se consulta acá son datos de clientes y precios de la
          // empresa: no se guarda del otro lado.
          store: false,
        } as unknown as Parameters<typeof cliente.responses.create>[0])
      } catch (e) {
        throw new FalloProveedor(clasificar(e), 'el proveedor no respondió')
      }

      const r = (respuesta ?? {}) as {
        output?: {
          type?: string
          call_id?: string
          id?: string
          name?: string
          arguments?: unknown
          content?: { type?: string; text?: string }[]
        }[]
      }
      const salida = r.output ?? []

      const llamadas: LlamadaHerramienta[] = salida
        .filter((o) => o.type === 'function_call' && typeof o.name === 'string')
        .map((o) => ({
          id: o.call_id ?? o.id ?? '',
          nombre: o.name as string,
          argumentos: argumentosDe(o.arguments),
        }))

      const texto = salida
        .flatMap((o) => o.content ?? [])
        .filter((c) => c.type === 'output_text')
        .map((c) => c.text ?? '')
        .join('')

      // Los ítems se guardan enteros para devolverlos en la vuelta siguiente.
      return { texto, llamadas, crudo: salida as unknown[] }
    },
  }
}

/**
 * El proveedor falso: contesta siempre lo mismo y no llama a nada.
 *
 * No intenta imitar a un modelo. Su trabajo es que la pantalla se pueda armar
 * y probar —que el chat escriba, que la traza se dibuje, que los errores se
 * vean— sin clave y sin gastar. Y que quede CLARÍSIMO que la IA está apagada:
 * un falso que contesta cosas plausibles es una trampa.
 */
const proveedorFalso: Proveedor = {
  nombre: 'falso',
  listo: false,
  responder: () =>
    Promise.resolve({
      texto:
        'La IA está apagada: esta función está desplegada pero sin proveedor configurado. ' +
        'Esto es una respuesta de prueba, no una respuesta de verdad.',
      llamadas: [],
    }),
}

const sinConfigurar = (nombre: string, detalle: string): Proveedor => ({
  nombre,
  listo: false,
  responder: () => Promise.reject(new FalloProveedor('sin_configurar', detalle)),
})

/** El proveedor configurado. Sin configuración: el falso, nunca uno real. */
export function proveedorConfigurado(): Proveedor {
  const nombre = (Deno.env.get('IA_PROVIDER') ?? 'falso').trim()
  if (nombre === 'falso') return proveedorFalso
  if (nombre !== 'openai') return sinConfigurar(nombre, 'proveedor desconocido')

  const clave = Deno.env.get('OPENAI_API_KEY')
  if (!clave) return sinConfigurar('openai', 'falta la clave del proveedor')

  const modelo = (Deno.env.get('IA_MODELO') ?? MODELO_POR_DEFECTO).trim()
  if (!(MODELOS as readonly string[]).includes(modelo)) {
    return sinConfigurar('openai', 'modelo no habilitado')
  }
  const esfuerzo = (Deno.env.get('IA_ESFUERZO') ?? 'low').trim()
  if (!(ESFUERZOS as readonly string[]).includes(esfuerzo)) {
    return sinConfigurar('openai', 'esfuerzo no habilitado')
  }

  return proveedorOpenAI(
    new OpenAI({ apiKey: clave, timeout: TIMEOUT_MS, maxRetries: REINTENTOS }),
    modelo,
    esfuerzo,
  )
}

/** Cuánto audio se acepta. Un minuto y medio de voz entra de sobra. */
export const MAX_BYTES_AUDIO = 8 * 1024 * 1024

/**
 * Pasar un audio a texto (Fase 36 · E2).
 *
 * Existe para poder preguntar hablando, que en un depósito o manejando es la
 * única forma cómoda. Lo transcripto entra al chat **como si se hubiera
 * escrito**: no se manda directo al asistente.
 *
 * Eso último es a propósito. La transcripción se equivoca con los SKU —«SP
 * punto dos mil ocho» puede salir de diez maneras— y una consulta armada sobre
 * una referencia mal oída devuelve el producto equivocado con total aplomo.
 * Verlo escrito antes de enviar cuesta un segundo y evita eso.
 */
export async function transcribir(audio: Blob): Promise<string> {
  const nombre = (Deno.env.get('IA_PROVIDER') ?? 'falso').trim()
  if (nombre === 'falso') {
    throw new FalloProveedor('sin_configurar', 'la transcripción está apagada')
  }
  const clave = Deno.env.get('OPENAI_API_KEY')
  if (!clave) throw new FalloProveedor('sin_configurar', 'falta la clave del proveedor')

  const cuerpo = new FormData()
  cuerpo.append('file', audio, 'consulta.webm')
  cuerpo.append('model', (Deno.env.get('IA_MODELO_AUDIO') ?? 'whisper-1').trim())
  // El idioma se fija: sin esto, un audio corto en castellano rioplatense a
  // veces se transcribe como portugués o italiano.
  cuerpo.append('language', 'es')

  let r: Response
  try {
    r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clave}` },
      body: cuerpo,
    })
  } catch {
    throw new FalloProveedor('caido', 'el proveedor no respondió')
  }

  if (!r.ok) {
    throw new FalloProveedor(
      r.status === 429 ? 'limite' : r.status === 401 || r.status === 403 ? 'rechazo' : 'caido',
      'el proveedor rechazó el audio',
    )
  }

  const datos: unknown = await r.json().catch(() => null)
  const texto = (datos as { text?: unknown } | null)?.text
  return typeof texto === 'string' ? texto.trim() : ''
}
