/**
 * Estado del sync con STEL (Fase 14 E4), para mostrarlo en Configuración → Numeración.
 *
 * Es observabilidad, no un panel de control: no hay botón para lanzar un sync ni
 * para editar el checkpoint. La clave de la API vive sólo en el servidor y en los
 * scripts locales; acá no llega nada de eso.
 */
export type EntidadSync = 'products' | 'documents'
export type EstadoSync = 'idle' | 'running' | 'finished' | 'failed'

export interface SyncStel {
  entidad: EntidadSync
  estado: EstadoSync
  inicio: string | null
  fin: string | null
  checkpoint: string | null
  ultimoVisto: string | null
  llamadas: number
  error: string | null
  bloqueado: boolean
  resumen: Record<string, unknown>
}

export const ETIQUETA_ENTIDAD: Record<EntidadSync, string> = {
  products: 'Catálogo (productos y precios)',
  documents: 'Documentos (cotizaciones, pedidos y remitos)',
}

/** Estado → chip. `running` con candado viejo se ve igual: lo resuelve el TTL del servidor. */
export function presentarEstadoSync(s: SyncStel): { etiqueta: string; tono: 'ok' | 'alerta' | 'error' | 'neutro'; detalle: string } {
  if (s.estado === 'failed') {
    return { etiqueta: 'Con error', tono: 'error', detalle: s.error ?? 'La última corrida falló. El checkpoint no avanzó: al reintentar retoma desde donde estaba.' }
  }
  if (s.estado === 'running') {
    return { etiqueta: 'En curso', tono: 'alerta', detalle: 'Hay una sincronización corriendo. No se lanza otra hasta que termine.' }
  }
  if (s.estado === 'finished') {
    return { etiqueta: 'Al día', tono: 'ok', detalle: 'La última sincronización terminó bien.' }
  }
  return { etiqueta: 'Sin correr', tono: 'neutro', detalle: 'Todavía no se sincronizó esta entidad.' }
}

/** Fecha corta y legible; null → «—». */
export function fechaCorta(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** «hace 3 horas» a partir de la última corrida, para ver de un vistazo si quedó vieja. */
export function desdeHace(iso: string | null, ahora: number = Date.now()): string {
  if (!iso) return 'nunca'
  const ms = ahora - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`
}
