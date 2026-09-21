import type { DocumentoFuente, EstadoHistorico, ServicioHistorico } from '../types'

/**
 * Cómo se cuenta el historial importado de STEL (Fase 20 · E2).
 *
 * La regla que gobierna todo este archivo: **un servicio histórico no es
 * trabajo pendiente de hoy**. Un presupuesto que STEL dejó en «Pendiente» en
 * 2023 quedó pendiente *allá*; llamarlo «pendiente» a secas fabricaría una
 * cola de trabajo que nadie tiene. Por eso las etiquetas dicen dónde quedó.
 */
const ESTADOS: Record<EstadoHistorico, string> = {
  closed: 'Servicio entregado',
  open_quote: 'Presupuesto quedó pendiente en STEL',
  in_progress: 'Quedó en curso en STEL',
}

export const etiquetaDeEstadoHistorico = (v: string): string =>
  ESTADOS[v as EstadoHistorico] ?? v

const DOCUMENTOS: Record<DocumentoFuente['tipo'], string> = {
  estimate: 'Presupuesto',
  work_order: 'Orden de trabajo',
  delivery_note: 'Remito de trabajo',
}

export const etiquetaDeDocumento = (v: string): string => DOCUMENTOS[v as DocumentoFuente['tipo']] ?? v

/**
 * El encabezado de un evento: estado y, si se sabe, si se facturó.
 *
 * `invoiced` sólo significa algo cuando hubo remito. En un presupuesto
 * pendiente, decir «sin facturar» sugeriría que falta facturarlo.
 */
export function tituloDeEvento(s: ServicioHistorico): string {
  const base = etiquetaDeEstadoHistorico(s.estado)
  if (s.estado !== 'closed' || s.facturado === null) return base
  return `${base} · ${s.facturado ? 'Facturado' : 'Sin facturar'}`
}

/**
 * Qué decir del importe.
 *
 * Con un solo equipo en la cadena, el importe del documento es de este equipo.
 * Compartido, **no se reparte**: se midió que las unidades de las líneas no
 * siguen a la cantidad de equipos, así que dividir sería inventar un número
 * dentro de un historial. Se dice que es compartido y, si sirve, se muestra el
 * total de la cadena como contexto —nunca como costo del equipo—.
 */
export interface ImporteDelServicio {
  propio: boolean
  monto: number | null
  moneda: string | null
  nota: string | null
}

export function importeDelServicio(s: ServicioHistorico): ImporteDelServicio {
  if (s.importeAtribuible === 'asset' && s.importe !== null) {
    return { propio: true, monto: s.importe, moneda: s.moneda, nota: null }
  }
  return {
    propio: false,
    monto: s.importeDeLaCadena,
    moneda: s.moneda,
    nota: 'Importe compartido entre varios equipos',
  }
}

/** «Compartido con otros 6 equipos», o nada cuando el servicio fue de uno solo. */
export function compartidoCon(s: ServicioHistorico): string | null {
  const otros = s.equiposEnElServicio - 1
  if (otros <= 0) return null
  return otros === 1 ? 'Servicio compartido con otro equipo' : `Servicio compartido con otros ${otros} equipos`
}

/**
 * El texto que se muestra en el evento.
 *
 * STEL no tiene diagnóstico, así que `diagnostico` viene nulo y no se
 * reemplaza por el texto del trabajo: sería fabricar un diagnóstico que nadie
 * escribió. Si no hay nada, se dice que no hay nada.
 */
export function resumenDelServicio(s: ServicioHistorico): string | null {
  return s.trabajo ?? s.titulo ?? null
}

/** Cuántas líneas con contenido tiene un documento, para no ofrecer un vacío. */
export const tieneDetalle = (d: DocumentoFuente): boolean => d.lineas.length > 0
