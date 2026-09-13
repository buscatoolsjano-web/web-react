/**
 * Construcción de mensajes RFC 5322 / MIME para Gmail.
 *
 * Reglas, todas probadas:
 *
 *   · **Ninguna cabecera lleva un CR o LF que venga del usuario.** Una dirección,
 *     un asunto o un nombre de archivo con `\r\n` se rechaza (direcciones) o se
 *     aplana (texto libre) ANTES de llegar acá: es la puerta de la inyección de
 *     cabeceras (`Bcc:` agregado a escondidas).
 *   · Texto no ASCII en cabeceras: encoded-words de RFC 2047 (`=?UTF-8?B?…?=`),
 *     partidas para no pasar de 75 caracteres.
 *   · Nombres de archivo: `filename*` de RFC 2231 además del `filename` ASCII.
 *   · Cuerpos y adjuntos en base64 con líneas de 76 caracteres y CRLF.
 *   · `multipart/alternative` (texto + HTML) siempre; dentro de
 *     `multipart/mixed` cuando hay adjuntos.
 *
 * Bcc va en el mensaje crudo: Gmail la usa para entregar y la saca antes de
 * mandarlo a los demás destinatarios.
 */
import { randomBytes } from 'node:crypto'

export interface Direccion {
  direccion: string
  nombre?: string | null
}

export interface AdjuntoSaliente {
  nombre: string
  mime: string
  bytes: Buffer
  /** Si se define, va inline con este Content-ID. */
  contentId?: string | null
}

export interface MensajeSaliente {
  de: Direccion
  para: Direccion[]
  cc: Direccion[]
  cco: Direccion[]
  asunto: string
  messageId: string
  inReplyTo?: string | null
  references?: string | null
  texto: string
  html: string
  adjuntos: AdjuntoSaliente[]
  cabecerasExtra?: Record<string, string>
  fecha?: Date
  /** Un borrador puede no tener destinatarios todavía (Gmail lo permite). Un envío, no. */
  borrador?: boolean
}

const CRLF = '\r\n'

export class MimeInvalido extends Error {
  constructor(motivo: string) {
    super(motivo)
    this.name = 'MimeInvalido'
  }
}

/**
 * Validación RAZONABLE de una dirección. No es un parser de RFC 5321 completo
 * —no hace falta y un regex «perfecto» es inmantenible—: exige local@dominio,
 * dominio con punto y etiquetas válidas, y rechaza lo que rompe una cabecera
 * (espacios, CR/LF, comas, `<>`, comillas, punto y coma). Acepta `+`, guiones,
 * puntos, subdominios y TLD largos, que es lo que un regex simplista suele
 * bloquear.
 */
export function direccionValida(d: string): boolean {
  if (typeof d !== 'string' || d.length > 254) return false
  const i = d.lastIndexOf('@')
  if (i < 1 || i === d.length - 1) return false
  const local = d.slice(0, i)
  const dominio = d.slice(i + 1)
  if (local.length > 64) return false
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false
  const etiquetas = dominio.split('.')
  if (etiquetas.length < 2) return false
  return etiquetas.every((e) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(e))
}

/** Texto libre para una cabecera: sin controles, sin saltos. */
export function aplanar(texto: string): string {
  return texto.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
}

const esAscii = (s: string) => /^[\x20-\x7e]*$/.test(s)

/** RFC 2047, en trozos que respetan los límites de UTF-8. */
export function codificarPalabras(texto: string): string {
  const limpio = aplanar(texto)
  if (esAscii(limpio)) return limpio
  const trozos: string[] = []
  let actual = ''
  for (const ch of limpio) {
    // 45 bytes de payload → 60 de base64 → 72 con el envoltorio.
    if (Buffer.byteLength(actual + ch) > 45) {
      trozos.push(actual)
      actual = ch
    } else {
      actual += ch
    }
  }
  if (actual) trozos.push(actual)
  return trozos.map((t) => `=?UTF-8?B?${Buffer.from(t, 'utf8').toString('base64')}?=`).join(CRLF + ' ')
}

export function formatearDireccion(d: Direccion): string {
  if (!direccionValida(d.direccion)) throw new MimeInvalido('direccion_invalida')
  const nombre = d.nombre ? aplanar(d.nombre) : ''
  if (!nombre) return d.direccion
  if (esAscii(nombre)) return `"${nombre.replace(/["\\]/g, '')}" <${d.direccion}>`
  return `${codificarPalabras(nombre)} <${d.direccion}>`
}

function lista(ds: Direccion[]): string {
  return ds.map(formatearDireccion).join(`,${CRLF} `)
}

function base64Lineas(b: Buffer): string {
  const s = b.toString('base64')
  const out: string[] = []
  for (let i = 0; i < s.length; i += 76) out.push(s.slice(i, i + 76))
  return out.join(CRLF)
}

/** Nombre legible para el MIME. No se usa nunca como ruta de nada. */
export function nombreArchivo(nombre: string): string {
  const limpio = aplanar(nombre).replace(/[\\/:*?"<>|]/g, '_').slice(0, 180)
  return limpio || 'adjunto'
}

function disposicion(tipo: 'attachment' | 'inline', nombre: string): string {
  const n = nombreArchivo(nombre)
  const ascii = n.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(n)}`
}

const MIME_SEGURO = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i

function limite(): string {
  return `=_bt_${randomBytes(12).toString('hex')}`
}

function parteTexto(tipo: 'plain' | 'html', contenido: string): string {
  return [
    `Content-Type: text/${tipo}; charset="UTF-8"`,
    'Content-Transfer-Encoding: base64',
    '',
    base64Lineas(Buffer.from(contenido, 'utf8')),
  ].join(CRLF)
}

export function messageIdValido(id: string): boolean {
  return /^<[^<>\s@]+@[A-Za-z0-9.-]+>$/.test(id)
}

/** Construye el mensaje crudo (bytes) que se sube a Gmail. */
export function construirMime(m: MensajeSaliente): Buffer {
  if (!m.borrador && m.para.length + m.cc.length + m.cco.length === 0) throw new MimeInvalido('sin_destinatarios')
  if (!messageIdValido(m.messageId)) throw new MimeInvalido('message_id_invalido')
  for (const ref of [m.inReplyTo, m.references]) {
    if (ref && !/^(<[^<>\s]+>)( <[^<>\s]+>)*$/.test(ref)) throw new MimeInvalido('referencias_invalidas')
  }

  const cab: string[] = [
    `From: ${formatearDireccion(m.de)}`,
    ...(m.para.length ? [`To: ${lista(m.para)}`] : []),
    ...(m.cc.length ? [`Cc: ${lista(m.cc)}`] : []),
    ...(m.cco.length ? [`Bcc: ${lista(m.cco)}`] : []),
    `Subject: ${codificarPalabras(m.asunto)}`,
    `Date: ${(m.fecha ?? new Date()).toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${m.messageId}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references ? [`References: ${m.references}`] : []),
    'MIME-Version: 1.0',
  ]
  for (const [k, v] of Object.entries(m.cabecerasExtra ?? {})) {
    if (!/^X-BT-[A-Za-z-]+$/.test(k)) throw new MimeInvalido('cabecera_extra_invalida')
    cab.push(`${k}: ${aplanar(v)}`)
  }

  const bAlt = limite()
  const alternativa = [
    `--${bAlt}`,
    parteTexto('plain', m.texto),
    `--${bAlt}`,
    parteTexto('html', m.html),
    `--${bAlt}--`,
  ].join(CRLF)

  if (m.adjuntos.length === 0) {
    return Buffer.from(
      [...cab, `Content-Type: multipart/alternative; boundary="${bAlt}"`, '', alternativa, ''].join(CRLF),
      'utf8',
    )
  }

  const bMix = limite()
  const partes = m.adjuntos.map((a) => {
    const mime = MIME_SEGURO.test(a.mime) ? a.mime.toLowerCase() : 'application/octet-stream'
    const inline = !!a.contentId
    if (inline && !/^[A-Za-z0-9._@-]{1,200}$/.test(a.contentId!)) throw new MimeInvalido('content_id_invalido')
    return [
      `--${bMix}`,
      `Content-Type: ${mime}; name="${nombreArchivo(a.nombre).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: ${disposicion(inline ? 'inline' : 'attachment', a.nombre)}`,
      ...(inline ? [`Content-ID: <${a.contentId}>`] : []),
      '',
      base64Lineas(a.bytes),
    ].join(CRLF)
  })

  return Buffer.from(
    [
      ...cab,
      `Content-Type: multipart/mixed; boundary="${bMix}"`,
      '',
      `--${bMix}`,
      `Content-Type: multipart/alternative; boundary="${bAlt}"`,
      '',
      alternativa,
      ...partes,
      `--${bMix}--`,
      '',
    ].join(CRLF),
    'utf8',
  )
}
