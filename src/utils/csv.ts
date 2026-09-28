/**
 * Lo compartido de la exportación a CSV.
 *
 * Vive acá desde la Fase 29 · E8, cuando Mantenimiento necesitó exportar y
 * lo único que había era la versión de Clientes. Copiarla habría dejado dos
 * escapados y dos BOM: el día que uno se arregle, el otro se queda viejo.
 *
 * Cada módulo sigue armando SUS columnas —son distintas y tienen que serlo—;
 * lo que se comparte es cómo se escapa una celda y cómo se dispara la
 * descarga.
 */

/** Escapa un campo. La coma, el punto y coma y las comillas rompen un CSV. */
export function celda(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return ''
  const s = String(valor)
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** Una tabla completa: encabezados y filas, separadas por `;` y CRLF. */
export function aCsv(columnas: readonly string[], filas: readonly (readonly (string | number | null | undefined)[])[]): string {
  const lineas = [columnas.join(';')]
  for (const f of filas) lineas.push(f.map(celda).join(';'))
  return lineas.join('\r\n')
}

/**
 * Dispara la descarga.
 *
 * El BOM va adelante a propósito: sin él Excel en Windows abre las tildes
 * rotas, y casi todo lo que se exporta acá tiene tildes.
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
