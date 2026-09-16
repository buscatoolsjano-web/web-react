import { Totals, type TotalRow } from '@/components/document/DocSection'
import { formatearCantidad, formatearImporte } from '../lib/formato'
import { unidadesDe } from '../lib/totales'
import type { DocumentoDetalle, LineaDocumento } from '../types'

export interface TotalesDocumentoProps {
  doc: DocumentoDetalle
  lineas: readonly LineaDocumento[]
  /** Nota al pie (p. ej. de dónde salen los números mientras se edita). */
  nota?: string | undefined
}

/**
 * Los totales del documento, iguales para los tres tipos.
 *
 * Dos reglas que no se negocian:
 *
 * - Los importes vienen del servidor, que los calcula con un trigger. Acá no
 *   se recalcula nada: sólo se ordena y se rotula.
 * - **Nunca se suman dos monedas.** Todo lo que se muestra es de la moneda del
 *   documento, y si el documento no tiene moneda el número va solo.
 *
 * El descuento global y la percepción se muestran como porcentaje y no como
 * importe: la base guarda el porcentaje y el efecto ya está dentro del
 * subtotal y del impuesto. Despejar el importe sería reconstruir a mano una
 * cuenta que el servidor ya hizo.
 */
export function TotalesDocumento({ doc, lineas, nota }: TotalesDocumentoProps) {
  const unidades = unidadesDe(lineas)

  const filas: TotalRow[] = [
    { label: 'Unidades', value: formatearCantidad(unidades) },
    { label: 'Subtotal', value: formatearImporte(doc.subtotal, doc.moneda) },
  ]

  if (doc.descuentoPct !== null && doc.descuentoPct !== 0) {
    filas.push({ label: 'Descuento global', value: `${formatearCantidad(doc.descuentoPct)} %` })
  }

  // El servidor guarda un solo `tax_amount`: impuesto y percepción van juntos.
  // Partirlo acá sería inventar un desglose que la base no tiene (Fase 15 E0,
  // «desglose por alícuota»).
  filas.push({
    label: doc.percepcionPct ? 'Impuestos y percepciones' : 'Impuestos',
    value: formatearImporte(doc.impuesto, doc.moneda),
  })

  if (doc.percepcionPct !== null && doc.percepcionPct !== 0) {
    filas.push({ label: 'Percepción aplicada', value: `${formatearCantidad(doc.percepcionPct)} %` })
  }

  filas.push({ label: 'Total', value: formatearImporte(doc.total, doc.moneda), strong: true })

  return <Totals rows={filas} note={nota} />
}
