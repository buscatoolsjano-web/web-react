/**
 * Autoridad de numeración en Ventas (Fase 12, E2.5).
 *
 * Mientras STEL numere un tipo de documento de la empresa, el ERP no lo emite:
 * no lo crea, no lo duplica, no lo convierte, no lo marca enviado/aceptado, no
 * lo confirma ni lo despacha. Lo que lo IMPIDE es la base (`next_document_number`,
 * triggers y `confirmar_entrega`); esto sólo anticipa el bloqueo en pantalla y
 * traduce el error.
 */
import type { TipoDocumento } from '../types'

export type DocTypeVentas = 'quote' | 'sales_order' | 'delivery'
export type AutoridadNumeracion = 'STEL' | 'ERP'

export const DOC_TYPE_DE: Record<TipoDocumento, DocTypeVentas> = {
  cotizacion: 'quote',
  pedido: 'sales_order',
  entrega: 'delivery',
}

/** Código estable que devuelve la base. */
export const CODIGO_AUTORIDAD_EXTERNA = 'external_numbering_authority'

export const MENSAJE_AUTORIDAD_EXTERNA =
  'La numeración de este documento todavía está administrada por STEL. No se puede emitir desde el ERP hasta completar la migración.'

export const TITULO_BANNER_STEL = 'STEL sigue administrando la numeración de este documento.'

const PLURAL: Record<DocTypeVentas, string> = {
  quote: 'las cotizaciones',
  sales_order: 'los pedidos',
  delivery: 'las notas de entrega',
}

/**
 * Motivo visible junto a las acciones deshabilitadas. Con más de un tipo
 * bloqueado en la misma barra va en una sola línea: en mobile la barra es fija.
 */
export function motivoBloqueo(...docTypes: DocTypeVentas[]): string {
  const nombres = docTypes.map((t) => PLURAL[t])
  const lista = nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}` : (nombres[0] ?? '')
  return `Emisión desde el ERP bloqueada: STEL numera ${lista} de esta empresa.`
}

/** Filas del servidor → mapa por tipo. Lo que no está configurado es ERP. */
export function mapaAutoridad(
  filas: readonly { doc_type: string; authority: string }[],
): Record<DocTypeVentas, AutoridadNumeracion> {
  const mapa: Record<DocTypeVentas, AutoridadNumeracion> = {
    quote: 'ERP',
    sales_order: 'ERP',
    delivery: 'ERP',
  }
  for (const f of filas) {
    if ((f.doc_type === 'quote' || f.doc_type === 'sales_order' || f.doc_type === 'delivery') && f.authority === 'STEL') {
      mapa[f.doc_type] = 'STEL'
    }
  }
  return mapa
}

export function esErrorAutoridadExterna(e: unknown): boolean {
  const texto = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  return texto.includes(CODIGO_AUTORIDAD_EXTERNA)
}

/**
 * Fase 14 E3: códigos estables de las invariantes de workflow (triggers de la base
 * y validaciones del servicio) → texto para la persona.
 */
export const MENSAJES_WORKFLOW: Record<string, string> = {
  DELIVERY_ALREADY_DISPATCHED: 'El remito ya generó movimiento de stock y no puede cancelarse directamente.',
  DELIVERY_CANCELLED: 'El remito está cancelado.',
  DELIVERY_STATUS_REQUIRES_DISPATCH: 'El remito sólo avanza con «Confirmar y despachar», que descuenta el stock.',
  DOCUMENT_CURRENCY_REQUIRED: 'Elegí la moneda del documento: no hay moneda por defecto.',
  DOCUMENT_CURRENCY_MISMATCH: 'El documento tiene que conservar la moneda de su documento de origen.',
}

/** Mensaje para mostrar de cualquier error de una acción de Ventas. */
export function mensajeErrorVentas(e: unknown): string {
  if (esErrorAutoridadExterna(e)) return MENSAJE_AUTORIDAD_EXTERNA
  const texto = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  const codigo = Object.keys(MENSAJES_WORKFLOW).find((c) => texto.includes(c))
  if (codigo) return MENSAJES_WORKFLOW[codigo]!
  if (e instanceof Error) return e.message
  return 'Ocurrió un error inesperado.'
}
