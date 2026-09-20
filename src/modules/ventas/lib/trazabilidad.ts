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
  /**
   * Los campos que cambiaron. Cada clave trae un `{ from, to }`, salvo
   * `lineas`, que desde la Fase 15 · E2 es una lista de cambios de línea.
   */
  diff: Record<string, unknown> | null
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

/** Los campos auditados, con el nombre que usa la gente. */
const CAMPO: Record<string, string> = {
  unit_price: 'Precio unitario',
  quantity: 'Cantidad',
  quantity_ordered: 'Cantidad pedida',
  discount_pct: 'Descuento',
  perception_pct: 'Percepción',
  // Fase 15 · E2: los de la cabecera que ahora se editan.
  title: 'Título',
  customer_id: 'Cliente',
  contact_id: 'Contacto',
  salesperson_id: 'Vendedor',
  price_list_id: 'Tarifa',
  payment_terms: 'Forma de pago',
  currency_code: 'Moneda',
  quote_date: 'Fecha',
  valid_until: 'Válida hasta',
  exchange_rate: 'Tipo de cambio',
  notes: 'Observaciones',
  description_snapshot: 'Descripción',
  tax_treatment: 'Impuesto',
}

/**
 * Los campos que mueven la plata (Fase 19 · E3).
 *
 * El servidor guarda TODA la edición con la misma acción —
 * `updated_sensitive_fields`—, así que el título hay que sacarlo de lo que
 * cambió: anunciar «Cambio en precios o cantidades» en una edición que sólo
 * tocó las observaciones le miente a quien lee el historial.
 */
const CAMPOS_DE_IMPORTE = new Set([
  'unit_price',
  'quantity',
  'quantity_ordered',
  'discount_pct',
  'perception_pct',
  'exchange_rate',
  'currency_code',
  'tax_treatment',
  'tax_rate_snapshot',
])

function tocaImportes(diff: Record<string, unknown> | null): boolean {
  for (const [clave, crudo] of Object.entries(diff ?? {})) {
    if (clave === 'lineas' && Array.isArray(crudo)) {
      for (const l of crudo as CambioDeLinea[]) {
        // Agregar o quitar una línea mueve el total siempre; modificarla,
        // sólo si lo que cambió fue un importe.
        if (l.accion === 'agregada' || l.accion === 'eliminada') return true
        if (Object.keys(l.cambios ?? {}).some((k) => CAMPOS_DE_IMPORTE.has(k))) return true
      }
      continue
    }
    if (CAMPOS_DE_IMPORTE.has(clave)) return true
  }
  return false
}

/**
 * Los campos que guardan una referencia.
 *
 * De estos NO se muestra el valor: es un uuid, y un uuid en pantalla no le
 * dice nada a nadie. Se cuenta qué pasó —se asignó, se cambió, se quitó— que
 * es la información que hay.
 */
const REFERENCIAS = new Set(['customer_id', 'contact_id', 'salesperson_id', 'price_list_id'])

function cambioDeReferencia(campo: string, from: unknown, to: unknown): string {
  const nombre = nombreDeCampo(campo)
  if (from === null || from === undefined) return `${nombre}: se asignó`
  if (to === null || to === undefined) return `${nombre}: se quitó`
  return `${nombre}: cambió`
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

/** Un cambio de línea, tal como lo guarda `guardar_cotizacion`. */
interface CambioDeLinea {
  accion?: string
  linea?: number
  producto?: string
  cantidad?: number
  precio?: number
  cambios?: Record<string, { from: unknown; to: unknown }>
}

/**
 * Una línea agregada, modificada o eliminada, en una sola frase.
 *
 * El número de línea y el SKU alcanzan para encontrarla; el uuid no aporta
 * nada a quien lee el historial.
 */
function textoDeLinea(l: CambioDeLinea): string {
  const donde = `Línea ${l.linea ?? '?'}${l.producto ? ` (${l.producto})` : ''}`
  if (l.accion === 'agregada') {
    return `${donde}: agregada, ${valor(l.cantidad)} × ${valor(l.precio)}`
  }
  if (l.accion === 'eliminada') {
    return `${donde}: eliminada (era ${valor(l.cantidad)} × ${valor(l.precio)})`
  }
  const partes = Object.entries(l.cambios ?? {}).map(
    ([k, c]) => `${nombreDeCampo(k).toLowerCase()} ${valor(c.from)} → ${valor(c.to)}`,
  )
  return partes.length > 0 ? `${donde}: ${partes.join(', ')}` : `${donde}: modificada`
}

/** El título del evento; la edición se titula por lo que cambió. */
function titulo(e: EventoAuditoria): string {
  if (e.accion === 'updated_sensitive_fields') {
    return tocaImportes(e.diff) ? TITULO[e.accion]! : 'Cambio en el documento'
  }
  return TITULO[e.accion] ?? nombreDeCampo(e.accion)
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

  for (const [clave, crudo] of Object.entries(e.diff ?? {})) {
    // Los cambios de líneas vienen aparte, como lista (Fase 15 · E2).
    if (clave === 'lineas' && Array.isArray(crudo)) {
      for (const l of crudo as CambioDeLinea[]) detalle.push(textoDeLinea(l))
      continue
    }
    // Cualquier otra forma sería el payload crudo: no se muestra.
    if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) continue
    const cambio = crudo as { from: unknown; to: unknown }
    if (REFERENCIAS.has(clave)) {
      detalle.push(cambioDeReferencia(clave, cambio.from, cambio.to))
      continue
    }
    detalle.push(`${nombreDeCampo(clave)}: ${valor(cambio.from)} → ${valor(cambio.to)}`)
  }

  return {
    id: e.id,
    titulo: titulo(e),
    detalle,
    cuando: formatearMomento(e.fecha),
    // Sin actor el evento lo escribió una función de negocio, no una persona.
    quien: e.actor ?? 'Proceso del sistema',
  }
}
