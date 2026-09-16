import { presentarEstado } from './estados'
import type { TipoDocumento } from '../types'

/**
 * Los eventos de `sales_audit`, contados para una persona.
 *
 * `sales_audit` no es un log técnico: se escribe sólo desde funciones de
 * negocio y guarda un diff acotado a los campos que cambian cuánto paga el
 * cliente. Esta capa traduce ese registro y **deja afuera todo lo técnico**:
 * no muestra ids, ni la RPC que lo escribió, ni el JSON crudo.
 */

export interface EventoAuditoria {
  id: number
  accion: string
  desde: string | null
  hasta: string | null
  diff: Record<string, { from: unknown; to: unknown }> | null
  /** Nombre de quien lo hizo; `null` cuando lo escribió un proceso. */
  actor: string | null
  /** `timestamptz` tal como vuelve de la base. */
  fecha: string
}

export interface EventoPresentable {
  id: number
  titulo: string
  /** Una línea por cambio. Vacío si el evento no tiene detalle que contar. */
  detalle: string[]
  cuando: string
  quien: string
}

const TITULO: Record<string, string> = {
  created: 'Documento creado',
  updated_sensitive_fields: 'Cambio en precios o cantidades',
  sent: 'Marcado como enviado',
  approved: 'Aceptado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
}

/** Los campos que audita `esSensible`, con el nombre que usa la gente. */
const CAMPO: Record<string, string> = {
  unit_price: 'Precio unitario',
  quantity: 'Cantidad',
  quantity_ordered: 'Cantidad pedida',
  discount_pct: 'Descuento',
  perception_pct: 'Percepción',
}

/** Un campo que todavía no tiene nombre propio se muestra legible, nunca crudo. */
function nombreDeCampo(clave: string): string {
  const conocido = CAMPO[clave]
  if (conocido) return conocido
  const texto = clave.replace(/_/g, ' ')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/** Un valor del diff. `null` es «estaba vacío», y se dice así. */
function valor(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'sin valor'
  if (typeof v === 'number') return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 }).format(v)
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  if (typeof v === 'string') return v
  // Un objeto o un array serían el payload crudo: no se muestran.
  return 'sin detalle'
}

/** `2026-09-16T14:32:10Z` → `16/09/2026 11:32`, en la hora de quien mira. */
export function formatearMomento(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

export function presentarEvento(e: EventoAuditoria, tipo: TipoDocumento): EventoPresentable {
  const detalle: string[] = []

  // El cambio de estado se cuenta con las mismas etiquetas que el chip del
  // documento: «Pendiente → Cerrada», no «sent → accepted».
  if (e.desde || e.hasta) {
    const desde = e.desde ? presentarEstado(tipo, e.desde).etiqueta : null
    const hasta = e.hasta ? presentarEstado(tipo, e.hasta).etiqueta : null
    if (desde && hasta) detalle.push(`Estado: ${desde} → ${hasta}`)
    else if (hasta) detalle.push(`Estado: ${hasta}`)
  }

  for (const [clave, cambio] of Object.entries(e.diff ?? {})) {
    if (!cambio || typeof cambio !== 'object') continue
    detalle.push(`${nombreDeCampo(clave)}: ${valor(cambio.from)} → ${valor(cambio.to)}`)
  }

  return {
    id: e.id,
    titulo: TITULO[e.accion] ?? nombreDeCampo(e.accion),
    detalle,
    cuando: formatearMomento(e.fecha),
    // Sin actor el evento lo escribió una función de negocio, no una persona.
    quien: e.actor ?? 'Proceso del sistema',
  }
}
