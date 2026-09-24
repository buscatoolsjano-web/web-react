import type { AdjuntoContenido, ClaseSugerencia, EstadoTrabajo, SugerenciaCliente } from '../types'

export const ETIQUETA_ESTADO: Record<EstadoTrabajo, string> = {
  pendiente: 'Pendiente',
  en_proceso: 'En proceso',
  resuelto: 'Resuelto',
}

/**
 * Fecha de la bandeja: la hora si es de hoy, día y mes si es de este año, la
 * fecha completa si no. Siempre en la zona de Argentina, que es la del equipo.
 */
export function fechaBandeja(iso: string | null, ahora: Date = new Date()): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const tz = 'America/Argentina/Buenos_Aires'
  const dia = (x: Date) => x.toLocaleDateString('es-AR', { timeZone: tz })
  if (dia(d) === dia(ahora)) {
    return d.toLocaleTimeString('es-AR', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
  }
  const anio = (x: Date) => x.toLocaleDateString('es-AR', { timeZone: tz, year: 'numeric' })
  if (anio(d) === anio(ahora)) {
    return d.toLocaleDateString('es-AR', { timeZone: tz, day: 'numeric', month: 'short' })
  }
  return d.toLocaleDateString('es-AR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function fechaCompleta(ms: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function tamanoLegible(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

/**
 * ¿Se puede mirar sin bajarlo? (Fase 28 · E8)
 *
 * Sólo PDF e imágenes. Un  con un .docx no muestra nada o, peor, se
 * lo baja solo, que es justo lo que se quería evitar.
 */
export function sePuedeVer(mime: string): boolean {
  return mime === 'application/pdf' || mime.startsWith('image/')
}

/**
 * Los adjuntos que se listan: los que alguien mandó. Las imágenes inline son
 * parte del cuerpo y ya se ven ahí.
 */
export function adjuntosVisibles(adjuntos: AdjuntoContenido[]): AdjuntoContenido[] {
  return adjuntos.filter((a) => !a.inline)
}

/** «2 participantes más» en vez de una lista de diez direcciones. */
export function resumenParticipantes(participantes: string[], propia: string | null, max = 2): string {
  const otros = participantes.filter((p) => !propia || p.toLowerCase() !== propia.toLowerCase())
  const lista = otros.length > 0 ? otros : participantes
  if (lista.length === 0) return '—'
  const visibles = lista.slice(0, max).join(', ')
  const resto = lista.length - max
  return resto > 0 ? `${visibles} y ${resto} más` : visibles
}

export const ETIQUETA_CLASE: Record<ClaseSugerencia, string> = {
  exacto: 'Coincidencia exacta',
  sugerido_dominio: 'Mismo dominio',
  ambiguo: 'Ambiguo',
}

/**
 * Las sugerencias de CRM, listas para mostrar.
 *
 * Ninguna se aplica sola: la arquitectura aprobó auto-vincular el exacto, pero
 * hacerlo en el sync rompería la invariante «el sync nunca toca el estado del
 * ERP». Se muestran, en orden de confianza, y la persona decide.
 *
 * `recomendada` marca UNA sola: el único exacto, si hay uno solo. Un ambiguo
 * nunca es recomendado.
 */
export function presentarSugerencias(
  sugerencias: SugerenciaCliente[],
): Array<SugerenciaCliente & { recomendada: boolean }> {
  const orden: Record<ClaseSugerencia, number> = { exacto: 0, sugerido_dominio: 1, ambiguo: 2 }
  const vistos = new Set<string>()
  const unicas = [...sugerencias]
    .sort((a, b) => orden[a.clase] - orden[b.clase] || a.clienteNombre.localeCompare(b.clienteNombre))
    .filter((s) => {
      const clave = `${s.clienteId}|${s.contactoId ?? ''}`
      if (vistos.has(clave)) return false
      vistos.add(clave)
      return true
    })
  const clientesExactos = new Set(unicas.filter((s) => s.clase === 'exacto').map((s) => s.clienteId))
  return unicas.map((s) => ({
    ...s,
    recomendada: s.clase === 'exacto' && clientesExactos.size === 1,
  }))
}
