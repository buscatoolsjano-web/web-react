/**
 * Numeración: cómo se muestra el diagnóstico de `config_numeracion_diagnostico`.
 *
 * Todo es lectura. La autoridad de numeración (STEL o ERP) sale de la base
 * (`document_numbering_authority`, Fase 12 E2.5): con STEL, la base bloquea la
 * emisión desde el ERP. Esta pantalla no ofrece editar nada, tampoco la autoridad.
 */

export type EstadoSecuencia = 'OK' | 'BEHIND' | 'AHEAD' | 'SIN_DOCUMENTOS' | 'UNKNOWN'
export type Autoridad = 'STEL' | 'ERP'

export interface SecuenciaDiagnostico {
  docType: string
  serie: string
  prefijo: string
  padding: number
  esDefault: boolean
  proximo: string
  proximoNumero: number
  documentos: number
  fueraPatron: number
  maxNumero: number | null
  maxSinAtipicos: number | null
  atipicosPorEncima: number
  estado: EstadoSecuencia
  autoridad: Autoridad
  /** Hay una fila explícita de autoridad; sin fila, el ERP numera por defecto. */
  autoridadConfigurada: boolean
}

const TIPOS: Record<string, string> = {
  quote: 'Cotizaciones',
  sales_order: 'Pedidos de venta',
  delivery: 'Notas de entrega (remitos)',
  customer: 'Clientes',
  supplier: 'Proveedores',
  purchase_order: 'Pedidos de compra',
  goods_receipt: 'Notas de entrada',
  supplier_invoice: 'Facturas de proveedor (ref. interna)',
  maintenance_asset: 'Equipos de mantenimiento',
  maintenance_order: 'Órdenes de servicio',
}

/** Número con el formato de la secuencia: prefijo + ceros a la izquierda. */
export function formatearNumero(s: Pick<SecuenciaDiagnostico, 'prefijo' | 'padding'>, n: number | null): string {
  return n === null ? '—' : `${s.prefijo}${String(n).padStart(s.padding, '0')}`
}

export function etiquetaTipo(docType: string): string {
  return TIPOS[docType] ?? docType
}

export function normalizarEstado(e: string): EstadoSecuencia {
  return (['OK', 'BEHIND', 'AHEAD', 'SIN_DOCUMENTOS'] as const).includes(e as never) ? (e as EstadoSecuencia) : 'UNKNOWN'
}

export interface Presentacion {
  etiqueta: string
  tono: 'ok' | 'alerta' | 'error' | 'neutro'
  detalle: string
}

export function presentarEstado(s: Pick<SecuenciaDiagnostico, 'estado' | 'prefijo' | 'padding' | 'maxSinAtipicos' | 'proximo'>): Presentacion {
  switch (s.estado) {
    case 'OK':
      return { etiqueta: 'Al día', tono: 'ok', detalle: 'El próximo número es el siguiente al mayor existente.' }
    case 'BEHIND':
      return {
        etiqueta: 'Atrasada',
        tono: 'error',
        detalle: `Colisión: ya existe ${formatearNumero(s, s.maxSinAtipicos)} y el próximo número sería ${s.proximo}.`,
      }
    case 'AHEAD':
      return {
        etiqueta: 'Adelantada',
        tono: 'alerta',
        detalle: `Hay un salto: el mayor existente es ${formatearNumero(s, s.maxSinAtipicos)} y el próximo sería ${s.proximo}. No pisa números, pero deja huecos.`,
      }
    case 'SIN_DOCUMENTOS':
      return { etiqueta: 'Sin documentos', tono: 'neutro', detalle: 'Todavía no hay documentos de este tipo en esta base.' }
    default:
      return { etiqueta: 'Desconocido', tono: 'neutro', detalle: 'No se pudo comparar este tipo contra documentos.' }
  }
}

export function presentarAutoridad(a: Autoridad): Presentacion {
  return a === 'STEL'
    ? {
        etiqueta: 'STEL',
        tono: 'alerta',
        detalle:
          'STEL Order numera estos documentos. Los números que emitió después de la última importación no están en esta base, así que «Al día» no descarta una colisión con STEL. La base bloquea la emisión de este tipo desde el ERP.',
      }
    : { etiqueta: 'ERP', tono: 'neutro', detalle: 'El ERP numera estos documentos con su propia secuencia.' }
}

/** Qué pasa con la emisión desde el ERP según la autoridad. */
export function presentarEmision(a: Autoridad): Presentacion {
  return a === 'STEL'
    ? {
        etiqueta: 'Emisión desde ERP bloqueada',
        tono: 'error',
        detalle:
          'La base rechaza crear, duplicar, convertir, enviar, confirmar o despachar este tipo desde el ERP (error external_numbering_authority). Consultar, exportar e importar sigue funcionando.',
      }
    : { etiqueta: 'Emisión desde ERP habilitada', tono: 'neutro', detalle: 'El ERP emite este tipo con su secuencia.' }
}

/** Alertas a mostrar arriba de la tabla. */
export function alertas(lista: readonly SecuenciaDiagnostico[]): string[] {
  const out: string[] = []
  const atrasadas = lista.filter((s) => s.estado === 'BEHIND')
  if (atrasadas.length) out.push(`${atrasadas.length} secuencia(s) atrasada(s): el próximo número ya existe (${atrasadas.map((s) => etiquetaTipo(s.docType)).join(', ')}).`)
  const stel = lista.filter((s) => s.autoridad === 'STEL')
  if (stel.length) out.push(`STEL es la autoridad de ${stel.map((s) => etiquetaTipo(s.docType).toLowerCase()).join(', ')}. La comparación sólo usa lo importado y la emisión desde el ERP está bloqueada.`)
  const atipicos = lista.filter((s) => s.atipicosPorEncima > 0)
  for (const s of atipicos) out.push(`${etiquetaTipo(s.docType)}: ${s.atipicosPorEncima} número(s) atípico(s) del import (p. ej. ${formatearNumero(s, s.maxNumero)}) quedan por encima del próximo y no se tienen en cuenta.`)
  return out
}

// ── Autoridad por serie (Fase 14 E5) ────────────────────────────────────────
/**
 * Excepción de autoridad para UNA serie dentro de un tipo
 * (`document_numbering_authority_series`). Hoy la usa RT-ML: los remitos los
 * emite el ERP, salvo los de MercadoLibre, que los sigue emitiendo STEL.
 */
export interface AutoridadSerie {
  docType: string
  serie: string
  autoridad: Autoridad
  motivo: string
}

export interface FilaAutoridad {
  docType: string
  serie: string
  /** «Remitos MercadoLibre · RT-ML» */
  etiqueta: string
  autoridad: Autoridad
  /** La autoridad viene de una excepción de serie, no del tipo. */
  porSerie: boolean
  /** STEL y sin secuencia en el ERP: sólo entra por importación. */
  soloImportacion: boolean
  /** Próximo número reservado para emitir desde el ERP, o null si no aplica. */
  proximo: string | null
}

/** Series con nombre propio; el resto se nombra por su tipo. */
const SERIES: Record<string, string> = {
  'delivery/RT-ML': 'Remitos MercadoLibre',
}

/**
 * Qué sistema emite cada serie, combinando las secuencias con las excepciones.
 * La serie manda sobre el tipo; sin excepción, vale la autoridad del tipo. Una
 * excepción sin secuencia (RT-ML) igual se muestra: es justamente el caso que
 * hay que entender.
 */
export function filasAutoridad(
  secuencias: readonly SecuenciaDiagnostico[],
  series: readonly AutoridadSerie[],
): FilaAutoridad[] {
  const porClave = new Map(series.map((s) => [`${s.docType}/${s.serie}`, s]))
  const nombre = (docType: string, serie: string) => SERIES[`${docType}/${serie}`] ?? etiquetaTipo(docType)
  const filas: FilaAutoridad[] = []

  // Sólo los tipos que tienen semántica de autoridad: los de Ventas.
  for (const s of secuencias.filter((x) => ['quote', 'sales_order', 'delivery'].includes(x.docType))) {
    const excepcion = porClave.get(`${s.docType}/${s.serie}`)
    const autoridad = excepcion?.autoridad ?? s.autoridad
    filas.push({
      docType: s.docType,
      serie: s.serie,
      etiqueta: nombre(s.docType, s.serie),
      autoridad,
      porSerie: excepcion !== undefined,
      soloImportacion: autoridad === 'STEL',
      proximo: autoridad === 'STEL' ? null : s.proximo,
    })
  }

  // Excepciones de series que no tienen secuencia en el ERP.
  const yaEstan = new Set(filas.map((f) => `${f.docType}/${f.serie}`))
  for (const e of series) {
    if (yaEstan.has(`${e.docType}/${e.serie}`)) continue
    filas.push({
      docType: e.docType,
      serie: e.serie,
      etiqueta: nombre(e.docType, e.serie),
      autoridad: e.autoridad,
      porSerie: true,
      soloImportacion: e.autoridad === 'STEL',
      proximo: null,
    })
  }

  return filas.sort((a, b) => a.docType.localeCompare(b.docType) || a.serie.localeCompare(b.serie))
}

/** Cómo se lee una fila de autoridad. */
export function presentarFilaAutoridad(f: FilaAutoridad): Presentacion {
  if (f.autoridad === 'STEL') {
    return {
      etiqueta: f.soloImportacion ? 'STEL · Solo importación' : 'STEL',
      tono: 'alerta',
      detalle: f.soloImportacion
        ? 'STEL emite y numera esta serie. El ERP no la emite: sólo la importa para poder consultarla.'
        : 'STEL emite y numera esta serie.',
    }
  }
  return { etiqueta: 'ERP', tono: 'ok', detalle: 'El ERP emite y numera esta serie con su propia secuencia.' }
}
