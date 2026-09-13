/**
 * Del `threads.get?format=full` de Gmail al payload que dibuja la bandeja.
 *
 * Todo lo que sale de acá vive en memoria del request y en memoria del
 * componente que lo pidió. **Nada se persiste**: ni en Supabase, ni en disco, ni
 * en caché HTTP (la ruta responde `no-store`).
 *
 * El HTML se devuelve como vino. La sanitización y el aislamiento ocurren en el
 * navegador —DOMPurify, y después un iframe con `sandbox` sin `allow-scripts` y
 * con una CSP propia—, que es donde hay un DOM de verdad para sanitizar. Un
 * sanitizador de HTML hecho con expresiones regulares acá daría una falsa
 * sensación de seguridad: es exactamente el tipo de código que se saltea.
 */

export interface AdjuntoPayload {
  /** El `partId` de Gmail (`1`, `1.2`…). Estable dentro del mensaje, a diferencia del attachmentId. */
  partId: string
  nombre: string
  mime: string
  tamano: number
  /** Content-ID sin `<>`, para resolver las imágenes `cid:` del HTML. */
  contentId: string | null
  /** Imagen embebida en el cuerpo, no un adjunto que la persona mandó. */
  inline: boolean
}

export interface MensajePayload {
  id: string
  /** Epoch en milisegundos (internalDate de Gmail, más confiable que el header Date). */
  fecha: number
  de: string
  para: string
  cc: string
  /** Reply-To, si el remitente pidió que las respuestas vayan a otra dirección. */
  responderA: string
  asunto: string
  /** Sólo informativo: abrir en el ERP NO lo cambia. */
  noLeidoGmail: boolean
  html: string | null
  texto: string | null
  /** El cuerpo superaba el tope y se cortó. */
  truncado: boolean
  adjuntos: AdjuntoPayload[]
}

export interface HiloPayload {
  id: string
  asunto: string
  mensajes: MensajePayload[]
}

/** Tope por cuerpo. Un mail de más de 1 MB de HTML es casi siempre un newsletter con basura inline. */
export const TOPE_CUERPO = 1_000_000

interface ParteGmail {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: Array<{ name?: string; value?: string }>
  body?: { attachmentId?: string; size?: number; data?: string }
  parts?: ParteGmail[]
}

interface MensajeGmailCompleto {
  id?: string
  threadId?: string
  labelIds?: string[]
  internalDate?: string
  payload?: ParteGmail
}

function header(parte: ParteGmail | undefined, nombre: string): string {
  const n = nombre.toLowerCase()
  for (const h of parte?.headers ?? []) {
    if (h.name?.toLowerCase() === n) return h.value ?? ''
  }
  return ''
}

/** El charset del Content-Type, si lo trae. */
export function charsetDe(contentType: string): string {
  const m = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType)
  return m?.[1]?.toLowerCase() ?? 'utf-8'
}

/**
 * Gmail entrega el cuerpo ya sin el Content-Transfer-Encoding, pero hay que
 * elegir con qué decodificar los bytes.
 *
 * **Primero UTF-8 estricto; el charset declarado, sólo si los bytes no son UTF-8
 * válido.** Medido en producción: un newsletter real declaraba un charset que
 * `TextDecoder` resuelve como windows-1252 —`us-ascii` es uno de esos alias— y
 * sus bytes eran UTF-8 (el propio HTML decía `utf-8`). Resultado: «OpinÃ¡» en
 * vez de «Opiná», veinte veces en un solo mail.
 *
 * El orden es seguro: un texto Latin-1 con acentos casi nunca es UTF-8 válido
 * (una «á» sola es un byte 0xE1 sin continuación), así que cae al charset
 * declarado y se decodifica bien.
 */
export function decodificar(data: string, charset: string): string {
  const bytes = Buffer.from(data, 'base64url')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    /* no es UTF-8: se usa lo que declara el mensaje */
  }
  if (LATIN.has(charset)) return windows1252(bytes)
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes)
  } catch {
    return windows1252(bytes)
  }
}

/**
 * Los charsets que WHATWG resuelve como windows-1252. Se decodifican a mano:
 * medido, el `TextDecoder('windows-1252')` de Node 22 devuelve `` en vez
 * de «“» —decodifica ISO-8859-1 puro—, y los mails de Outlook usan justamente
 * esas comillas y guiones.
 */
const LATIN = new Set(['us-ascii', 'ascii', 'iso-8859-1', 'iso8859-1', 'latin1', 'l1', 'windows-1252', 'cp1252'])

/** 0x80–0x9F de windows-1252. Los huecos (0x81, 0x8D, 0x8F, 0x90, 0x9D) quedan como el byte. */
const W1252 = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
]

export function windows1252(bytes: Uint8Array): string {
  let salida = ''
  for (let i = 0; i < bytes.length; i += 0x4000) {
    const trozo = bytes.subarray(i, i + 0x4000)
    salida += String.fromCharCode(...Array.from(trozo, (b) => (b >= 0x80 && b <= 0x9f ? W1252[b - 0x80]! : b)))
  }
  return salida
}

function sinAngulos(v: string): string | null {
  const t = v.trim().replace(/^</, '').replace(/>$/, '').trim()
  return t === '' ? null : t
}

export interface PartePendiente {
  tipo: 'html' | 'texto'
  attachmentId: string
  charset: string
}

export interface MensajeAnalizado {
  payload: MensajePayload
  /** Cuerpos grandes que Gmail no mandó inline y hay que pedir aparte. */
  pendientes: PartePendiente[]
}

/**
 * Recorre las partes MIME.
 *
 * - `multipart/*` se recorre.
 * - Una parte con nombre de archivo, o disposición `attachment`, es un adjunto.
 * - Una imagen con Content-ID y sin disposición `attachment` es inline.
 * - El primer `text/html` y el primer `text/plain` que no sean adjuntos son el
 *   cuerpo. En `multipart/alternative` la UI prefiere el HTML.
 */
export function analizarMensaje(m: MensajeGmailCompleto): MensajeAnalizado {
  const raiz = m.payload
  const salida: MensajePayload = {
    id: m.id ?? '',
    fecha: Number(m.internalDate ?? '0') || 0,
    de: header(raiz, 'From'),
    para: header(raiz, 'To'),
    cc: header(raiz, 'Cc'),
    responderA: header(raiz, 'Reply-To'),
    asunto: header(raiz, 'Subject'),
    noLeidoGmail: (m.labelIds ?? []).includes('UNREAD'),
    html: null,
    texto: null,
    truncado: false,
    adjuntos: [],
  }
  const pendientes: PartePendiente[] = []

  const recorrer = (p: ParteGmail | undefined): void => {
    if (!p) return
    const mime = (p.mimeType ?? '').toLowerCase()
    if (mime.startsWith('multipart/')) {
      for (const hija of p.parts ?? []) recorrer(hija)
      return
    }
    const disposicion = header(p, 'Content-Disposition').toLowerCase()
    const contentId = sinAngulos(header(p, 'Content-ID'))
    const nombre = (p.filename ?? '').trim()
    const esAdjuntoDeclarado = disposicion.startsWith('attachment')
    const esCuerpo =
      (mime === 'text/html' || mime === 'text/plain') && nombre === '' && !esAdjuntoDeclarado

    if (esCuerpo) {
      const tipo = mime === 'text/html' ? 'html' : 'texto'
      if (salida[tipo] !== null) return
      const charset = charsetDe(header(p, 'Content-Type'))
      if (p.body?.data) {
        let txt = decodificar(p.body.data, charset)
        if (txt.length > TOPE_CUERPO) {
          txt = txt.slice(0, TOPE_CUERPO)
          salida.truncado = true
        }
        salida[tipo] = txt
      } else if (p.body?.attachmentId) {
        // Reservar el lugar: el primero gana aunque llegue después.
        salida[tipo] = ''
        pendientes.push({ tipo, attachmentId: p.body.attachmentId, charset })
      }
      return
    }

    if (p.body?.attachmentId || nombre !== '' || p.body?.data) {
      if (!p.partId) return
      const inline = contentId !== null && !esAdjuntoDeclarado && mime.startsWith('image/')
      salida.adjuntos.push({
        partId: p.partId,
        nombre: nombre !== '' ? nombre : inline ? `imagen-${p.partId}` : `adjunto-${p.partId}`,
        mime: mime || 'application/octet-stream',
        tamano: p.body?.size ?? 0,
        contentId,
        inline,
      })
    }
  }

  recorrer(raiz)
  return { payload: salida, pendientes }
}

/** Busca una parte por `partId` dentro del mensaje. */
export function buscarParte(
  m: unknown,
  partId: string,
): { mime: string; nombre: string; attachmentId: string | null; data: string | null } | null {
  const raiz = (m as MensajeGmailCompleto | undefined)?.payload
  const pila: ParteGmail[] = raiz ? [raiz] : []
  while (pila.length > 0) {
    const p = pila.pop()!
    if (p.partId === partId) {
      // Un cuerpo no se baja como adjunto por esta ruta.
      const mime = (p.mimeType ?? '').toLowerCase()
      if (mime.startsWith('multipart/')) return null
      return {
        mime: mime || 'application/octet-stream',
        nombre: (p.filename ?? '').trim(),
        attachmentId: p.body?.attachmentId ?? null,
        data: p.body?.data ?? null,
      }
    }
    for (const h of p.parts ?? []) pila.push(h)
  }
  return null
}

export function threadIdDe(m: unknown): string | null {
  return (m as MensajeGmailCompleto | undefined)?.threadId ?? null
}

/** Arma el payload del hilo, pidiendo aparte los cuerpos que Gmail no mandó inline. */
export async function armarHilo(
  crudo: unknown,
  pedirAdjunto: (mensajeId: string, attachmentId: string) => Promise<{ data: string; size: number }>,
): Promise<HiloPayload> {
  const h = crudo as { id?: string; messages?: MensajeGmailCompleto[] }
  const mensajes: MensajePayload[] = []
  let pedidos = 0
  for (const m of h.messages ?? []) {
    const { payload, pendientes } = analizarMensaje(m)
    for (const pend of pendientes) {
      // Tope de llamadas extra por hilo: cada una cuesta cuota.
      if (pedidos >= 6) {
        payload[pend.tipo] = payload[pend.tipo] || null
        payload.truncado = true
        continue
      }
      pedidos++
      const { data } = await pedirAdjunto(payload.id, pend.attachmentId)
      let txt = decodificar(data, pend.charset)
      if (txt.length > TOPE_CUERPO) {
        txt = txt.slice(0, TOPE_CUERPO)
        payload.truncado = true
      }
      payload[pend.tipo] = txt
    }
    if (payload.html === '') payload.html = null
    if (payload.texto === '') payload.texto = null
    mensajes.push(payload)
  }
  mensajes.sort((a, b) => a.fecha - b.fecha)
  return {
    id: h.id ?? '',
    asunto: mensajes[0]?.asunto ?? '',
    mensajes,
  }
}
