import { totalesPrevios } from './totales'
import type { DocumentoDetalle } from '../types'

/** Dos centavos: la misma tolerancia con la que se comparan importes redondeados. */
const TOLERANCIA = 0.02

export interface MotivosRevisados {
  /** Lo que sigue siendo cierto hoy, o no se puede verificar desde el documento. */
  vigentes: string[]
  /** Lo que la migración marcó y los datos de hoy desmienten. */
  resueltos: string[]
}

/**
 * Los motivos de revisión, contrastados con el documento que se está mirando.
 *
 * `review_reason` es una **foto del momento de la migración**, y la pantalla la
 * repetía como si fuera un hecho de hoy. Medido en producción (Fase 19 · E4):
 * 17 documentos avisaban «Sin moneda» teniendo moneda, 59 «Algún producto no
 * está en el catálogo» con todas las líneas resueltas, 48 «Los totales no
 * cierran» cerrando, y 14 pedidos «Sin cotización de origen» con su cotización
 * enlazada. Son 138 avisos que el propio dato desmiente.
 *
 * Acá NO se corrige ningún dato histórico —esa regla de la Fase 4 sigue en
 * pie—: se separa lo que todavía pasa de lo que ya no, y cada cosa se cuenta
 * como lo que es. Lo que no se sabe verificar desde el documento queda
 * **vigente**: no se declara resuelto lo que no se miró.
 */
export function revisarMotivos(doc: DocumentoDetalle): MotivosRevisados {
  const vigentes: string[] = []
  const resueltos: string[] = []
  for (const motivo of doc.motivosRevision) {
    if (seResolvio(motivo, doc)) resueltos.push(motivo)
    else vigentes.push(motivo)
  }
  return { vigentes, resueltos }
}

function seResolvio(motivo: string, doc: DocumentoDetalle): boolean {
  switch (motivo) {
    case 'MISSING_CURRENCY':
      return doc.moneda !== null && doc.moneda !== ''
    case 'NO_EXCHANGE_RATE':
      return doc.tipoCambio !== null
    case 'UNRESOLVED_SKU':
      return doc.lineas.filter((l) => l.tipoLinea !== 'chapter').every((l) => l.productId !== null)
    case 'NO_QUOTE_LINK':
      return doc.origen?.tipo === 'cotizacion'
    case 'NO_ORDER_LINK':
      return doc.origen?.tipo === 'pedido'
    case 'TOTALS_DO_NOT_CLOSE':
      return totalesCierran(doc)
    // `NUMBER_OUTLIER` tiene su propio aviso, con el número sospechado. Y lo
    // que cuenta CÓMO se migró —`DELIVERED_BY_ARRAY_INDEX`, las líneas de
    // entrega ambiguas— no se resuelve mirando el documento: es historia, y
    // como historia se deja.
    default:
      return false
  }
}

/**
 * Los totales guardados contra la fórmula del ERP.
 *
 * Si falta un importe —las 600 líneas de entrega históricas no tienen
 * precio— no se verifica nada: el aviso queda vigente. Mejor dejarlo puesto
 * de más que declarar cerrado lo que no se pudo sumar.
 */
function totalesCierran(doc: DocumentoDetalle): boolean {
  if (doc.subtotal === null || doc.impuesto === null || doc.total === null) return false
  const lineas = doc.lineas.filter((l) => l.tipoLinea !== 'chapter')
  if (lineas.length === 0 || lineas.some((l) => l.precioUnitario === null)) return false

  const t = totalesPrevios(lineas, doc.descuentoPct, doc.percepcionPct)
  return (
    Math.abs(t.subtotal - doc.subtotal) <= TOLERANCIA &&
    Math.abs(t.impuesto - doc.impuesto) <= TOLERANCIA &&
    Math.abs(t.total - doc.total) <= TOLERANCIA
  )
}
