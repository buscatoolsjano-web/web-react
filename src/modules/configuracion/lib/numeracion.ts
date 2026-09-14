/**
 * Numeración: cómo se muestra el diagnóstico de `config_numeracion_diagnostico`.
 *
 * Todo es lectura. Mientras STEL emita cotizaciones, pedidos y remitos de
 * Buscatools, React no es autoridad de esa numeración y esta pantalla no ofrece
 * editar nada.
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
          'STEL Order numera estos documentos. Los números que emitió después de la última importación no están en esta base, así que «Al día» no descarta una colisión con STEL. React no debe emitir este tipo mientras STEL siga activo.',
      }
    : { etiqueta: 'ERP', tono: 'neutro', detalle: 'El ERP numera estos documentos con su propia secuencia.' }
}

/** Alertas a mostrar arriba de la tabla. */
export function alertas(lista: readonly SecuenciaDiagnostico[]): string[] {
  const out: string[] = []
  const atrasadas = lista.filter((s) => s.estado === 'BEHIND')
  if (atrasadas.length) out.push(`${atrasadas.length} secuencia(s) atrasada(s): el próximo número ya existe (${atrasadas.map((s) => etiquetaTipo(s.docType)).join(', ')}).`)
  const stel = lista.filter((s) => s.autoridad === 'STEL')
  if (stel.length) out.push(`STEL es la autoridad de ${stel.map((s) => etiquetaTipo(s.docType).toLowerCase()).join(', ')}. La comparación sólo usa lo importado.`)
  const atipicos = lista.filter((s) => s.atipicosPorEncima > 0)
  for (const s of atipicos) out.push(`${etiquetaTipo(s.docType)}: ${s.atipicosPorEncima} número(s) atípico(s) del import (p. ej. ${formatearNumero(s, s.maxNumero)}) quedan por encima del próximo y no se tienen en cuenta.`)
  return out
}
