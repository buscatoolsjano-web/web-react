import type { TipoDocumento } from '../types'

export type TonoEstado = 'neutro' | 'info' | 'ok' | 'alerta' | 'error'

export interface EstadoPresentable {
  etiqueta: string
  tono: TonoEstado
}

/**
 * Estados por documento, con su etiqueta y su color.
 *
 * El legacy tenía UN estado por documento y en castellano. El modelo nuevo
 * separó el del pedido en cuatro (comercial, cumplimiento, facturación,
 * cobro), así que el mapeo no es uno a uno:
 *
 *   cotización  pendiente → sent      (154 migradas)
 *               cerrada   → accepted  (134)
 *               rechazada → rejected  (0 en el histórico)
 *   pedido      los tres  → commercial_status = confirmed  (166)
 *   entrega     los tres  → status = delivered             (182)
 *
 * `draft` y `expired` existen en el modelo y no tienen equivalente legacy:
 * son para documentos nuevos.
 */
const COTIZACION: Record<string, EstadoPresentable> = {
  draft: { etiqueta: 'Borrador', tono: 'neutro' },
  sent: { etiqueta: 'Pendiente', tono: 'alerta' },
  accepted: { etiqueta: 'Cerrada', tono: 'ok' },
  rejected: { etiqueta: 'Rechazada', tono: 'error' },
  expired: { etiqueta: 'Vencida', tono: 'neutro' },
}

const PEDIDO_COMERCIAL: Record<string, EstadoPresentable> = {
  draft: { etiqueta: 'Borrador', tono: 'neutro' },
  confirmed: { etiqueta: 'Confirmado', tono: 'ok' },
  cancelled: { etiqueta: 'Cancelado', tono: 'error' },
}

const PEDIDO_CUMPLIMIENTO: Record<string, EstadoPresentable> = {
  pending: { etiqueta: 'Sin entregar', tono: 'alerta' },
  partially_reserved: { etiqueta: 'Reserva parcial', tono: 'info' },
  reserved: { etiqueta: 'Reservado', tono: 'info' },
  partially_delivered: { etiqueta: 'Entrega parcial', tono: 'info' },
  delivered: { etiqueta: 'Entregado', tono: 'ok' },
}

const ENTREGA: Record<string, EstadoPresentable> = {
  draft: { etiqueta: 'Borrador', tono: 'neutro' },
  shipped: { etiqueta: 'Despachada', tono: 'info' },
  delivered: { etiqueta: 'Entregada', tono: 'ok' },
  cancelled: { etiqueta: 'Cancelada', tono: 'error' },
}

const TABLA: Record<TipoDocumento, Record<string, EstadoPresentable>> = {
  cotizacion: COTIZACION,
  pedido: PEDIDO_COMERCIAL,
  entrega: ENTREGA,
}

/** Un estado desconocido se muestra crudo, no se oculta ni se inventa. */
export function presentarEstado(tipo: TipoDocumento, estado: string | null): EstadoPresentable {
  if (!estado) return { etiqueta: '—', tono: 'neutro' }
  return TABLA[tipo][estado] ?? { etiqueta: estado, tono: 'neutro' }
}

export function presentarCumplimiento(estado: string | null): EstadoPresentable {
  if (!estado) return { etiqueta: '—', tono: 'neutro' }
  return PEDIDO_CUMPLIMIENTO[estado] ?? { etiqueta: estado, tono: 'neutro' }
}

/** Opciones del filtro de estado, por documento. */
export function estadosDisponibles(tipo: TipoDocumento): { valor: string; etiqueta: string }[] {
  return Object.entries(TABLA[tipo]).map(([valor, e]) => ({ valor, etiqueta: e.etiqueta }))
}

/**
 * Los motivos de revisión que dejó la migración.
 *
 * Se guardan concatenados con ` | ` en `review_reason`, y algunos llevan un
 * detalle después de `:` que acá no se muestra.
 */
const MOTIVOS: Record<string, string> = {
  NO_EXCHANGE_RATE: 'Sin tipo de cambio',
  MISSING_CURRENCY: 'Sin moneda',
  UNRESOLVED_SKU: 'Algún producto no está en el catálogo',
  TOTALS_DO_NOT_CLOSE: 'Los totales no cierran',
  NO_ORDER_LINK: 'Sin pedido de origen',
  NO_QUOTE_LINK: 'Sin cotización de origen',
  NUMBER_OUTLIER: 'Número fuera de serie',
  DELIVERED_BY_ARRAY_INDEX: 'Entregas registradas por posición',
  ORDER_LINE_AMBIGUOUS: 'No se pudo determinar a qué línea del pedido corresponde',
  ORDER_LINE_UNRESOLVED: 'Se entregó un producto que no está en el pedido',
  OVERDELIVERED: 'Se entregó más de lo pedido',
}

export function separarMotivos(reviewReason: string | null): string[] {
  if (!reviewReason) return []
  return reviewReason
    .split(' | ')
    .map((m) => m.split(':')[0]?.trim() ?? '')
    .filter((m) => m !== '')
}

export function presentarMotivo(motivo: string): string {
  return MOTIVOS[motivo] ?? motivo
}
