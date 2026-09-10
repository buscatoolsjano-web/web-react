import type { ClienteListado } from '../types'

/**
 * Exportación del listado a CSV.
 *
 * Las columnas son las del listado legacy —Referencia, Nombre jurídico,
 * Nombre, CUIT, Email, Dominio, Rubro— más las dos que la migración agregó y
 * que sirven para trabajar la cola de revisión: si el cliente vino del
 * histórico y por qué quedó marcado.
 *
 * El legacy exportaba **un solo email** por cliente porque en su modelo había
 * uno solo. Acá `emails` es un array y se vuelcan todos, separados por espacio,
 * dentro de la misma celda: perder direcciones al exportar sería perder datos.
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
  'Nombre juridico',
  'Nombre',
  'CUIT',
  'Emails',
  'Dominios',
  'Rubro',
  'Telefono',
  'Origen',
  'Observaciones',
] as const

export function aCsv(filas: readonly ClienteListado[]): string {
  const lineas = [COLUMNAS.join(';')]
  for (const c of filas) {
    lineas.push(
      [
        celda(c.referencia),
        celda(c.razonSocial),
        celda(c.nombreComercial),
        celda(c.cuit),
        celda(c.emails.join(' ')),
        celda(c.dominios.join(' ')),
        celda(c.rubro),
        celda(c.telefono),
        celda(c.esHistorico ? 'migrado' : 'nuevo'),
        celda(c.motivosRevision.join(' | ')),
      ].join(';'),
    )
  }
  return lineas.join('\r\n')
}

/**
 * Dispara la descarga.
 *
 * El BOM va adelante a propósito: sin él Excel en Windows abre las tildes
 * rotas, y casi todos los nombres de cliente tienen tildes.
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
