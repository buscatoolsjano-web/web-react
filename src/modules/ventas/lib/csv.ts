import type { DocumentoListado, TipoDocumento } from '../types'
import { presentarEstado } from './estados'

/**
 * Exportación a CSV.
 *
 * Las columnas son las del legacy —Referencia, Cliente, Título, Estado,
 * Fecha, Origen, Total— con **una corrección**: el legacy escribía la columna
 * como «Total USD» y volcaba ahí cualquier importe. En el histórico hay
 * cuatro monedas, así que la moneda va en su propia columna y el total sin
 * suponer nada.
 */

/** Escapa un campo. La coma y las comillas son lo que rompe un CSV. */
export function celda(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return ''
  const s = String(valor)
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

const COLUMNAS = [
  'Referencia',
  'Cliente',
  'Titulo',
  'Estado',
  'Fecha',
  'Origen',
  'Moneda',
  'Total',
  'Serie',
  'Observaciones',
] as const

export function aCsv(tipo: TipoDocumento, filas: readonly DocumentoListado[]): string {
  const lineas = [COLUMNAS.join(';')]
  for (const d of filas) {
    lineas.push(
      [
        celda(d.numero),
        celda(d.clienteNombre),
        celda(d.titulo),
        celda(presentarEstado(tipo, d.estado).etiqueta),
        celda(d.fecha),
        celda(d.origen),
        celda(d.moneda),
        // Punto decimal y sin separador de miles: lo que abre bien en
        // cualquier planilla. El formato bonito es para la pantalla.
        celda(d.total === null ? '' : d.total.toFixed(2)),
        celda(d.serie),
        celda(d.motivosRevision.join(' | ')),
      ].join(';'),
    )
  }
  return lineas.join('\r\n')
}

/**
 * Dispara la descarga.
 *
 * El BOM de UTF-8 va adelante a propósito: sin él, Excel en Windows abre las
 * tildes rotas — y todos los nombres de cliente tienen tildes.
 */
export function descargarCsv(nombre: string, contenido: string): void {
  const blob = new Blob(['﻿' + contenido], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
