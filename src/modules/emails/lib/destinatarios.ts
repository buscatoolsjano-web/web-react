import type { MensajeContenido, ModoRedaccion } from '../types'

/**
 * Destinatarios de una respuesta, calculados del mensaje al que se responde.
 *
 * Es lo que la persona ve precargado y puede editar. El backend no lo recalcula:
 * valida cada dirección, saca duplicados y decide From, hilo y cabeceras.
 */

/**
 * Validación RAZONABLE, igual a la del backend (`mime.ts`). No es un parser de
 * RFC 5321: exige local@dominio con punto y rechaza lo que rompe una cabecera.
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

/** Las direcciones de una cabecera como «Nombre <a@b>, "Otro, SA" <c@d>, e@f». */
export function extraerDirecciones(cabecera: string): string[] {
  const salida: string[] = []
  const vistas = new Set<string>()
  for (const m of cabecera.matchAll(/<([^<>\s]+@[^<>\s]+)>|([^\s<>,;"']+@[^\s<>,;"']+)/g)) {
    const d = (m[1] ?? m[2] ?? '').trim().toLowerCase()
    if (d && direccionValida(d) && !vistas.has(d)) {
      vistas.add(d)
      salida.push(d)
    }
  }
  return salida
}

/** Parte un texto pegado o tipeado en direcciones: comas, punto y coma, espacios, saltos. */
export function partirEntrada(texto: string): { validas: string[]; invalidas: string[] } {
  const validas: string[] = []
  const invalidas: string[] = []
  const conAngulos = extraerDirecciones(texto)
  const resto = texto.replace(/<[^<>]*>/g, ' ').replace(/"[^"]*"/g, ' ')
  const piezas = resto.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)
  for (const p of piezas) {
    const d = p.toLowerCase()
    if (direccionValida(d)) {
      if (!validas.includes(d)) validas.push(d)
    } else if (p.includes('@')) {
      invalidas.push(p)
    }
  }
  for (const d of conAngulos) if (!validas.includes(d)) validas.push(d)
  return { validas, invalidas }
}

export interface DestinatariosIniciales {
  para: string[]
  cc: string[]
}

/**
 * Responder: al Reply-To si lo hay; si no, al remitente. Si el mensaje lo mandó
 * el propio buzón (respondés tu propio mensaje), a sus destinatarios originales —
 * es lo que hace Gmail.
 *
 * Responder a todos: eso, más To y Cc originales, sin el propio buzón, sin
 * duplicados y sin vacíos.
 */
export function destinatariosIniciales(
  modo: ModoRedaccion,
  mensaje: Pick<MensajeContenido, 'de' | 'para' | 'cc' | 'responderA'>,
  propia: string,
): DestinatariosIniciales {
  if (modo === 'nuevo' || modo === 'reenviar') return { para: [], cc: [] }
  const yo = propia.trim().toLowerCase()
  const remitente = extraerDirecciones(mensaje.de)
  const originales = extraerDirecciones(mensaje.para)
  const lomandeyo = remitente.includes(yo)

  const principal = lomandeyo
    ? originales
    : mensaje.responderA
      ? extraerDirecciones(mensaje.responderA)
      : remitente

  const para = principal.filter((d) => d !== yo)
  if (modo === 'responder') return { para, cc: [] }

  const vistas = new Set(para)
  vistas.add(yo)
  const extra = (lomandeyo ? [] : originales).concat(extraerDirecciones(mensaje.cc))
  const cc: string[] = []
  for (const d of extra) {
    if (!vistas.has(d)) {
      vistas.add(d)
      cc.push(d)
    }
  }
  return { para, cc }
}

/** Saca de las listas posteriores lo que ya está en las anteriores (Para > Cc > Cco). */
export function sinDuplicados(para: string[], cc: string[], cco: string[]): { para: string[]; cc: string[]; cco: string[] } {
  const vistas = new Set<string>()
  const filtrar = (lista: string[]) =>
    lista.filter((d) => {
      const k = d.toLowerCase()
      if (vistas.has(k)) return false
      vistas.add(k)
      return true
    })
  return { para: filtrar(para), cc: filtrar(cc), cco: filtrar(cco) }
}

export const ASUNTO = {
  respuesta: (original: string) => (/^\s*(re|rv|aw|sv|antw)\s*:/i.test(original) ? original.trim() : `Re: ${original.trim() || '(sin asunto)'}`),
  reenvio: (original: string) => (/^\s*(fwd?|rv|reenv(i|í)ado)\s*:/i.test(original) ? original.trim() : `Fwd: ${original.trim() || '(sin asunto)'}`),
}

/** Tope de adjuntos de la v1, igual al del backend. */
export const TOPE_ADJUNTOS_BYTES = 10 * 1024 * 1024

export function totalAdjuntos(adjuntos: Array<{ tamano: number }>): number {
  return adjuntos.reduce((a, x) => a + (Number.isFinite(x.tamano) ? x.tamano : 0), 0)
}
