/**
 * «Última conexión», estilo WhatsApp (Fase 145).
 *
 * Puro y testeable. Convierte el `last_seen_at` de alguien en un texto corto:
 * «en línea» si el latido es reciente, y si no, cuándo fue la última vez, con la
 * misma economía que WhatsApp —la hora si fue hoy, «ayer», y la fecha si fue
 * antes—. Sin dato, no inventa nada: devuelve cadena vacía y la pantalla no
 * muestra el renglón.
 *
 * El latido va cada 2 minutos; se da «en línea» con margen (menos de 5) para no
 * parpadear entre latido y latido.
 */
const EN_LINEA_MS = 5 * 60_000

function mismoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function ultimaConexionTexto(iso: string | null, ahora: Date = new Date()): string {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''

  const difMs = ahora.getTime() - t.getTime()
  if (difMs < EN_LINEA_MS) return 'en línea'

  const hora = t.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  if (mismoDia(t, ahora)) return `últ. vez hoy a las ${hora}`

  const ayer = new Date(ahora)
  ayer.setDate(ahora.getDate() - 1)
  if (mismoDia(t, ayer)) return `últ. vez ayer a las ${hora}`

  const fecha = t.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
  return `últ. vez el ${fecha}`
}

/** `true` si el latido es lo bastante reciente como para decir «en línea». */
export function estaEnLinea(iso: string | null, ahora: Date = new Date()): boolean {
  if (!iso) return false
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return false
  return ahora.getTime() - t.getTime() < EN_LINEA_MS
}
