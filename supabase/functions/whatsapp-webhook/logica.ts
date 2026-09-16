/**
 * Lógica pura del webhook de WhatsApp Cloud API.
 *
 * Sin Deno, sin red y sin la base: se testea desde vitest igual que cualquier
 * módulo de la aplicación. Acá viven las dos cosas que tienen que estar bien
 * sí o sí —el handshake y la firma— y la normalización del payload de Meta.
 *
 * Nada de este archivo imprime, registra ni devuelve un secreto.
 */

// ── Handshake de verificación (GET) ────────────────────────────────────────

export interface ResultadoHandshake {
  status: 200 | 403
  /** El cuerpo EXACTO que espera Meta: el challenge en texto plano, sin JSON. */
  body: string
}

/**
 * Meta verifica el endpoint una sola vez, con un GET.
 *
 * Responde el `hub.challenge` **tal cual**, como `text/plain`. Si se devuelve
 * JSON —aunque sea el mismo número entre comillas— Meta lo rechaza y el
 * webhook nunca queda configurado.
 *
 * El token se compara en tiempo constante: es un secreto y la comparación
 * ingenua filtra por dónde empieza a diferir.
 */
export function resolverHandshake(
  params: URLSearchParams,
  verifyToken: string | undefined,
): ResultadoHandshake {
  const modo = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')

  if (!verifyToken || modo !== 'subscribe' || token === null || challenge === null) {
    return { status: 403, body: 'Forbidden' }
  }
  if (!textosIguales(token, verifyToken)) {
    return { status: 403, body: 'Forbidden' }
  }
  return { status: 200, body: challenge }
}

// ── Firma (POST) ───────────────────────────────────────────────────────────

const HEX = /^[0-9a-f]+$/

/**
 * Compara dos secuencias de bytes sin filtrar por dónde difieren.
 *
 * La longitud sí se compara de entrada: la de un SHA-256 es pública y fija, no
 * hay nada que proteger ahí.
 */
export function bytesIguales(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diferencia = 0
  for (let i = 0; i < a.length; i++) diferencia |= (a[i] as number) ^ (b[i] as number)
  return diferencia === 0
}

/** La misma comparación para textos (el verify token). */
export function textosIguales(a: string, b: string): boolean {
  const enc = new TextEncoder()
  return bytesIguales(enc.encode(a), enc.encode(b))
}

function hexABytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !HEX.test(hex)) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export type MotivoFirma = 'ok' | 'sin_secreto' | 'sin_header' | 'formato_invalido' | 'no_coincide'

/**
 * Valida `X-Hub-Signature-256` contra el cuerpo CRUDO.
 *
 * El cuerpo tiene que ser el que llegó, byte por byte. Calcular el HMAC sobre
 * un JSON reserializado es el error clásico: `JSON.stringify(JSON.parse(x))`
 * reordena claves y cambia el escapado, así que la firma nunca coincide — o
 * peor, se «arregla» desactivando la validación.
 */
export async function verificarFirma(
  rawBody: string,
  header: string | null,
  appSecret: string | undefined,
): Promise<MotivoFirma> {
  if (!appSecret) return 'sin_secreto'
  if (!header) return 'sin_header'
  if (!header.startsWith('sha256=')) return 'formato_invalido'

  const recibida = hexABytes(header.slice('sha256='.length).trim().toLowerCase())
  if (!recibida || recibida.length !== 32) return 'formato_invalido'

  const enc = new TextEncoder()
  const clave = await crypto.subtle.importKey(
    'raw',
    enc.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const esperada = new Uint8Array(await crypto.subtle.sign('HMAC', clave, enc.encode(rawBody)))

  return bytesIguales(esperada, recibida) ? 'ok' : 'no_coincide'
}

// ── Normalización del payload ──────────────────────────────────────────────

/** Los tipos que Meta puede mandar. Lo que no esté acá se guarda como `unknown`. */
export const TIPOS_CONOCIDOS = [
  'text', 'image', 'document', 'audio', 'video', 'sticker',
  'location', 'contacts', 'interactive', 'reaction', 'button', 'order', 'system',
] as const
export type TipoMensaje = (typeof TIPOS_CONOCIDOS)[number] | 'unknown'

export interface MediaEntrante {
  id: string
  mime_type?: string
  sha256?: string
  filename?: string
}

export interface EventoMensaje {
  clase: 'mensaje'
  phoneNumberId: string
  wabaId: string | null
  waId: string
  profileName: string | null
  providerMessageId: string
  tipo: TipoMensaje
  /** El tipo crudo, cuando no es uno de los conocidos. */
  tipoCrudo: string
  texto: string | null
  caption: string | null
  replyTo: string | null
  /** ISO. Meta manda segundos Unix como string. */
  timestamp: string | null
  media: MediaEntrante | null
}

export interface EventoEstado {
  clase: 'estado'
  phoneNumberId: string
  wabaId: string | null
  providerMessageId: string
  estado: 'sent' | 'delivered' | 'read' | 'failed' | string
  timestamp: string | null
  errorCode: number | null
  errorDetalle: string | null
}

export type EventoNormalizado = EventoMensaje | EventoEstado

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const txt = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** Meta manda segundos Unix en un string. Una fecha inválida vale `null`, no hoy. */
export function aIso(unix: unknown): string | null {
  const n = typeof unix === 'number' ? unix : typeof unix === 'string' ? Number(unix) : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  const d = new Date(n * 1000)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** El texto que se muestra en la lista, según el tipo. Nunca inventa contenido. */
function textoDe(tipo: string, m: Record<string, unknown>): string | null {
  switch (tipo) {
    case 'text':
      return txt(obj(m.text)?.body)
    case 'button':
      return txt(obj(m.button)?.text)
    case 'interactive': {
      const i = obj(m.interactive)
      return txt(obj(i?.button_reply)?.title) ?? txt(obj(i?.list_reply)?.title)
    }
    case 'reaction':
      return txt(obj(m.reaction)?.emoji)
    case 'location': {
      const l = obj(m.location)
      return txt(l?.name) ?? txt(l?.address)
    }
    default:
      return null
  }
}

/** Media de un mensaje, si el tipo la trae. */
export function extraerMedia(tipo: string, m: Record<string, unknown>): MediaEntrante | null {
  if (!['image', 'document', 'audio', 'video', 'sticker'].includes(tipo)) return null
  const n = obj(m[tipo])
  const id = txt(n?.id)
  if (!id) return null
  const media: MediaEntrante = { id }
  const mime = txt(n?.mime_type)
  const sha = txt(n?.sha256)
  const nombre = txt(n?.filename)
  if (mime) media.mime_type = mime
  if (sha) media.sha256 = sha
  if (nombre) media.filename = nombre
  return media
}

/**
 * Payload de Meta → lista plana de eventos.
 *
 * `entry`, `changes`, `messages` y `statuses` son arrays **y Meta agrupa**: un
 * solo POST puede traer mensajes de varias conversaciones y acuses mezclados.
 * Suponer «un entry, un change, un mensaje» es el bug que hace perder mensajes
 * bajo carga, justo cuando más se notan.
 */
export function normalizarPayload(payload: unknown): EventoNormalizado[] {
  const raiz = obj(payload)
  if (!raiz || raiz.object !== 'whatsapp_business_account') return []

  const eventos: EventoNormalizado[] = []

  for (const entradaCruda of arr(raiz.entry)) {
    const entrada = obj(entradaCruda)
    if (!entrada) continue
    // El WABA se lee del evento; NUNCA se da por sentado cuál es.
    const wabaId = txt(entrada.id)

    for (const cambioCrudo of arr(entrada.changes)) {
      const cambio = obj(cambioCrudo)
      if (!cambio || (cambio.field !== undefined && cambio.field !== 'messages')) continue
      const value = obj(cambio.value)
      if (!value) continue

      const phoneNumberId = txt(obj(value.metadata)?.phone_number_id)
      if (!phoneNumberId) continue

      // El nombre de perfil viene aparte, en `contacts`, indexado por wa_id.
      const perfiles = new Map<string, string | null>()
      for (const cCrudo of arr(value.contacts)) {
        const c = obj(cCrudo)
        const waId = txt(c?.wa_id)
        if (waId) perfiles.set(waId, txt(obj(c?.profile)?.name))
      }

      for (const mCrudo of arr(value.messages)) {
        const m = obj(mCrudo)
        const id = txt(m?.id)
        const from = txt(m?.from)
        if (!m || !id || !from) continue

        const tipoCrudo = txt(m.type) ?? 'unknown'
        const tipo: TipoMensaje = (TIPOS_CONOCIDOS as readonly string[]).includes(tipoCrudo)
          ? (tipoCrudo as TipoMensaje)
          : 'unknown'

        eventos.push({
          clase: 'mensaje',
          phoneNumberId,
          wabaId,
          waId: from,
          profileName: perfiles.get(from) ?? null,
          providerMessageId: id,
          tipo,
          tipoCrudo,
          texto: textoDe(tipoCrudo, m),
          caption: txt(obj(m[tipoCrudo])?.caption),
          replyTo: txt(obj(m.context)?.id),
          timestamp: aIso(m.timestamp),
          media: extraerMedia(tipoCrudo, m),
        })
      }

      for (const sCrudo of arr(value.statuses)) {
        const s = obj(sCrudo)
        const id = txt(s?.id)
        if (!s || !id) continue

        // Meta manda `errors[]`; se guarda el código y un texto acotado, nunca
        // el objeto entero.
        const primerError = obj(arr(s.errors)[0])
        const codigo = typeof primerError?.code === 'number' ? primerError.code : null
        const detalle =
          txt(obj(primerError?.error_data)?.details) ?? txt(primerError?.title) ?? null

        eventos.push({
          clase: 'estado',
          phoneNumberId,
          wabaId,
          providerMessageId: id,
          estado: txt(s.status) ?? 'unknown',
          timestamp: aIso(s.timestamp),
          errorCode: codigo,
          errorDetalle: detalle ? detalle.slice(0, 500) : null,
        })
      }
    }
  }

  return eventos
}

/**
 * Id estable de un evento, para no registrar dos veces el mismo diagnóstico.
 *
 * No es la idempotencia de los mensajes —esa la da el índice único sobre el
 * `wamid`—: es sólo para la bitácora de errores.
 */
export function idDeEvento(e: EventoNormalizado): string {
  return e.clase === 'mensaje'
    ? `${e.phoneNumberId}:msg:${e.providerMessageId}`
    : `${e.phoneNumberId}:st:${e.providerMessageId}:${e.estado}`
}
