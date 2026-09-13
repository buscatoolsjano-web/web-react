/**
 * El contenido de lo que se envía.
 *
 * **El navegador manda TEXTO, nunca HTML.** El HTML lo genera este módulo,
 * escapando todo y agregando sólo lo que decide: párrafos, saltos de línea,
 * enlaces http/https y la cita. Así no hay HTML entrante que sanitizar: un
 * `<script>`, un `onerror=` o un `javascript:` que alguien escriba viajan como
 * texto visible, no como marcado.
 *
 * La cita de una respuesta o un reenvío sale del mensaje ORIGINAL leído de Gmail
 * en ese momento, convertido a texto y escapado. Nunca se reutiliza el HTML
 * entrante.
 */

export type Modo = 'nuevo' | 'responder' | 'responder_todos' | 'reenviar'

export function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Enlaces http/https sobre texto YA escapado. Ningún otro esquema. */
function enlazar(escapado: string): string {
  return escapado.replace(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi, (url) => `<a href="${url}">${url}</a>`)
}

export function textoAHtml(texto: string): string {
  const parrafos = texto.replace(/\r\n?/g, '\n').split(/\n{2,}/)
  return parrafos
    .map((p) => `<p style="margin:0 0 1em">${enlazar(escaparHtml(p)).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/**
 * HTML → texto, para CITAR. La salida se vuelve a escapar antes de ir al HTML,
 * así que acá no importa si queda algún resto de marcado: sólo se usa como texto.
 */
export function htmlATexto(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const n = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''
      }
      return ENTIDADES[e.toLowerCase()] ?? m
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const PREFIJO_RE = /^\s*(re|rv|aw|sv|antw)\s*:\s*/i
const PREFIJO_FWD = /^\s*(fwd?|rv|reenv(i|í)ado)\s*:\s*/i

export function asuntoRespuesta(original: string): string {
  const a = original.trim()
  return PREFIJO_RE.test(a) ? a : `Re: ${a || '(sin asunto)'}`
}

export function asuntoReenvio(original: string): string {
  const a = original.trim()
  return PREFIJO_FWD.test(a) ? a : `Fwd: ${a || '(sin asunto)'}`
}

export interface Original {
  de: string
  para: string
  cc: string
  fecha: number
  asunto: string
  texto: string | null
  html: string | null
}

function fechaCita(ms: number): string {
  return new Date(ms).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function cuerpoOriginal(o: Original): string {
  return (o.texto?.trim() || (o.html ? htmlATexto(o.html) : '')).slice(0, 200_000)
}

export interface Cita {
  texto: string
  html: string
}

/** El bloque que se agrega debajo del texto de la persona. Determinístico. */
export function cita(modo: Modo, o: Original | null): Cita {
  if (!o || modo === 'nuevo') return { texto: '', html: '' }
  const cuerpo = cuerpoOriginal(o)
  if (modo === 'reenviar') {
    const encabezado = [
      '---------- Mensaje reenviado ----------',
      `De: ${o.de}`,
      `Fecha: ${fechaCita(o.fecha)}`,
      `Asunto: ${o.asunto}`,
      `Para: ${o.para}`,
      ...(o.cc ? [`Cc: ${o.cc}`] : []),
    ]
    return {
      texto: `\n\n${encabezado.join('\n')}\n\n${cuerpo}`,
      html:
        `<br><div style="color:#555">${encabezado.map((l) => escaparHtml(l)).join('<br>')}</div><br>` +
        `<div>${escaparHtml(cuerpo).replace(/\n/g, '<br>')}</div>`,
    }
  }
  const linea = `El ${fechaCita(o.fecha)}, ${o.de} escribió:`
  return {
    texto: `\n\n${linea}\n${cuerpo.split('\n').map((l) => `> ${l}`).join('\n')}`,
    html:
      `<br><div>${escaparHtml(linea)}</div>` +
      `<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">` +
      `${escaparHtml(cuerpo).replace(/\n/g, '<br>')}</blockquote>`,
  }
}

/**
 * Separa lo que escribió la persona de la cita, al recuperar un borrador. La cita
 * es determinística: si el texto termina con ella, se corta. Si alguien la editó
 * en Gmail, no se puede separar: se devuelve todo como texto propio, y al volver
 * a guardar la cita se agrega de nuevo. Queda documentado como límite.
 */
export function separarCita(textoCompleto: string, c: Cita): { propio: string; teniaCita: boolean } {
  const t = textoCompleto.replace(/\r\n/g, '\n')
  if (c.texto && t.endsWith(c.texto)) return { propio: t.slice(0, t.length - c.texto.length), teniaCita: true }
  return { propio: t, teniaCita: false }
}

/**
 * In-Reply-To y References según RFC 5322 §3.6.4: In-Reply-To es el Message-ID
 * del mensaje al que se responde; References, las References de ése más su
 * Message-ID. Sin duplicados y con un tope, para que un hilo eterno no produzca
 * una cabecera de kilobytes.
 */
export function referencias(
  messageIdOriginal: string | undefined,
  referencesOriginal: string | undefined,
): { inReplyTo: string | null; references: string | null } {
  const id = (messageIdOriginal ?? '').trim()
  if (!/^<[^<>\s]+>$/.test(id)) return { inReplyTo: null, references: null }
  const previas = (referencesOriginal ?? '').match(/<[^<>\s]+>/g) ?? []
  const todas = [...previas.filter((r) => r !== id), id]
  const acotadas = todas.length > 20 ? [todas[0]!, ...todas.slice(-19)] : todas
  return { inReplyTo: id, references: acotadas.join(' ') }
}
