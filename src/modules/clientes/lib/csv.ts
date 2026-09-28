import type { ClienteListado } from '../types'
import { celda, descargarCsv } from '@/utils/csv'

// Se re-exportan para no romper a quien ya los importaba de acá.
export { celda, descargarCsv }

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

