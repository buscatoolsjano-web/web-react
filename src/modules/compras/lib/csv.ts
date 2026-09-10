import type { ProveedorListado } from '../types'

/**
 * Exportación del listado de proveedores a CSV.
 *
 * Las columnas son las del listado. Las notas NO se exportan: son fichas de
 * contacto de varias líneas —hay una de 773 caracteres— y meterlas en una
 * celda convierte el CSV en algo ilegible. Quien las necesite las lee en la
 * ficha, que es donde están enteras.
 */

/** Escapa un campo. La coma, el punto y coma y las comillas rompen un CSV. */
export function celda(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return ''
  const s = String(valor)
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

const COLUMNAS = [
  'Referencia',
  'Razon social',
  'Nombre comercial',
  'Pais',
  'Telefono',
  'Email',
  'Forma de pago',
  'Estado',
  'Origen',
  'Observaciones',
] as const

export function aCsv(filas: readonly ProveedorListado[]): string {
  const lineas = [COLUMNAS.join(';')]
  for (const p of filas) {
    lineas.push(
      [
        celda(p.referencia),
        celda(p.razonSocial),
        celda(p.nombreComercial),
        celda(p.pais),
        celda(p.telefono),
        celda(p.email),
        celda(p.formaPago),
        celda(p.dadoDeBaja ? 'baja' : p.estado),
        celda(p.esHistorico ? 'migrado' : 'nuevo'),
        celda(p.motivosRevision.join(' | ')),
      ].join(';'),
    )
  }
  return lineas.join('\r\n')
}

/**
 * Dispara la descarga.
 *
 * El BOM va adelante a propósito: sin él Excel en Windows abre las tildes
 * rotas, y varios proveedores las tienen.
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
