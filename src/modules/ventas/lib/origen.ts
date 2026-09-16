/**
 * De dónde salió un documento.
 *
 * Es dato real, no etiqueta decorativa: sale de `external_source`, de
 * `imported_at` y de la serie. En la empresa hay hoy tres procedencias
 * distintas conviviendo —287 cotizaciones traídas del legacy, 17
 * reconciliadas contra STEL y las emitidas por el ERP— y saber cuál es cambia
 * qué se puede hacer con el documento.
 *
 * Lo que NO hace: adivinar. Un documento sin `external_source` y sin
 * `imported_at` es del ERP porque no hay otra forma de que exista; cualquier
 * otra combinación se nombra por lo que dice el dato.
 */

export interface DatosDeOrigen {
  /** `external_source` de la fila: `'stel'` en todo lo que vino de STEL. */
  externalSource: string | null
  /** `imported_at !== null`: lo trajo una migración, no lo emitió el ERP. */
  esHistorico: boolean
  serie: string | null
}

export interface EtiquetaOrigen {
  texto: string
  /** Descripción larga, para el título del badge y la pestaña Información. */
  detalle: string
}

/** Las series terminadas en `-ML` son del canal de MercadoLibre (hoy, 5 remitos). */
const SUFIJO_MERCADO_LIBRE = '-ML'

/**
 * Las etiquetas de origen de un documento, de la más específica a la más
 * general. Casi siempre es una; un remito de MercadoLibre migrado son dos.
 */
export function presentarOrigen({ externalSource, esHistorico, serie }: DatosDeOrigen): EtiquetaOrigen[] {
  const etiquetas: EtiquetaOrigen[] = []

  if (serie?.endsWith(SUFIJO_MERCADO_LIBRE)) {
    etiquetas.push({
      texto: 'MercadoLibre',
      detalle: `Documento del canal de MercadoLibre (serie ${serie}).`,
    })
  }

  if (externalSource === 'stel') {
    etiquetas.push({
      texto: 'Migrado desde STEL',
      detalle: 'El documento se emitió en STEL y se trajo al ERP. El número y los importes son los de STEL.',
    })
  } else if (esHistorico) {
    etiquetas.push({
      texto: 'Migrado del sistema anterior',
      detalle: 'El documento viene de la migración del sistema anterior; su número es el original.',
    })
  } else {
    etiquetas.push({
      texto: 'Emitido en el ERP',
      detalle: 'El documento se creó y se numeró en este sistema.',
    })
  }

  return etiquetas
}
