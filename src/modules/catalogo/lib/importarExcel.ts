import { parsearFilas, type CatalogoParseado } from './importarCatalogo'
import type { DefinicionAtributo } from '../types'

/**
 * Lee un `.xlsx` y lo deja como `CatalogoParseado`, igual que el CSV (Fase 126).
 *
 * El export arma UNA HOJA POR CATEGORÍA, cada una con sus columnas. Para
 * importar se recorren todas las hojas y se UNEN los encabezados (en orden de
 * primera aparición); cada fila se ubica en esa unión y las columnas que esa
 * hoja no tenía quedan vacías —y vacío, al importar, no toca nada—. La hoja
 * oculta «Listas» (la de los desplegables) se saltea.
 *
 * De `{encabezados, filas}` en adelante es el MISMO camino que el CSV
 * (`parsearFilas`): detectar columnas, matchear por ID interno o Referencia.
 * ExcelJS se importa dinámico: sólo hace falta al leer un Excel.
 */
export async function parsearExcel(
  archivo: File | ArrayBuffer,
  definiciones: readonly DefinicionAtributo[],
): Promise<CatalogoParseado> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const buf = archivo instanceof ArrayBuffer ? archivo : await archivo.arrayBuffer()
  await wb.xlsx.load(buf)

  const encabezados: string[] = []
  const indicePorEncabezado = new Map<string, number>()
  const filas: string[][] = []

  wb.eachSheet((ws) => {
    if (ws.name.trim().toLowerCase() === 'listas') return // hoja interna de desplegables
    const colCount = ws.actualColumnCount || ws.columnCount
    if (colCount === 0) return

    // Encabezados de esta hoja → índice en la unión (nuevo si no existía).
    const mapHoja: number[] = []
    const cab = ws.getRow(1)
    for (let c = 1; c <= colCount; c++) {
      const h = celdaTexto(cab.getCell(c)).trim()
      let idx = indicePorEncabezado.get(h)
      if (idx === undefined) {
        idx = encabezados.length
        indicePorEncabezado.set(h, idx)
        encabezados.push(h)
      }
      mapHoja[c - 1] = idx
    }

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const fila: string[] = Array.from({ length: encabezados.length }, () => '')
      let algo = false
      for (let c = 1; c <= colCount; c++) {
        const destino = mapHoja[c - 1]
        if (destino === undefined) continue
        const v = celdaTexto(row.getCell(c))
        fila[destino] = v
        if (v.trim() !== '') algo = true
      }
      if (algo) filas.push(fila)
    }
  })

  return parsearFilas(encabezados, filas, definiciones)
}

/** El texto de una celda, robusto ante número, fecha, texto enriquecido o fórmula. */
function celdaTexto(cell: { text?: unknown; value?: unknown } | undefined): string {
  if (!cell) return ''
  // `cell.text` ya da la representación mostrada para casi todo.
  const t = cell.text
  if (typeof t === 'string') return t
  if (typeof t === 'number' || typeof t === 'boolean') return String(t)
  return deValor(cell.value)
}

/** El texto del `value` crudo cuando `text` no alcanzó (objeto raro). */
function deValor(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((x) => x.text ?? '').join('')
    const prim = o.result ?? o.text
    if (typeof prim === 'string') return prim
    if (typeof prim === 'number' || typeof prim === 'boolean') return String(prim)
  }
  return ''
}

/** ¿El archivo es un Excel? (por extensión o tipo MIME) */
export function esArchivoExcel(archivo: File): boolean {
  return /\.xlsx?$/i.test(archivo.name) || archivo.type.includes('spreadsheet') || archivo.type.includes('excel')
}
