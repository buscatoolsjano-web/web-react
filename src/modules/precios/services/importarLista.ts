import { supabase } from '@/services/supabase/client'
import type { Celda, Renglon } from '../lib/importarLista'

/**
 * Leer el archivo y cargarlo (Fase de importación de listas, 2026-11-17).
 *
 * La lógica de qué es cada columna vive en `lib/importarLista.ts` (pura, con
 * tests); acá está lo que toca afuera: el archivo y la base.
 */

export interface ArchivoLeido {
  filas: Celda[][]
  /** La hoja que se usó, si era un Excel con varias. */
  hoja: string | null
}

/**
 * Las celdas del archivo. De un Excel se usa la hoja con más renglones con
 * datos (las listas suelen traer una hoja de portada o de condiciones), y
 * cada celda con su VALOR, no con su texto formateado: un precio es más
 * confiable como número que como «1.234,56».
 */
export async function leerArchivoLista(archivo: File): Promise<ArchivoLeido> {
  if (/\.xls$/i.test(archivo.name)) {
    throw new Error('Los .xls viejos no se pueden leer. Abrilo en Excel y guardalo como .xlsx (o como CSV).')
  }
  if (/\.(csv|txt)$/i.test(archivo.name) || archivo.type === 'text/csv') {
    const { leerCsv } = await import('../lib/importarLista')
    return { filas: leerCsv(await decodificar(archivo)), hoja: null }
  }
  if (!/\.xlsx$/i.test(archivo.name) && !archivo.type.includes('spreadsheet')) {
    throw new Error('Tiene que ser un Excel (.xlsx) o un CSV.')
  }

  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await archivo.arrayBuffer())

  let mejor: ArchivoLeido = { filas: [], hoja: null }
  let mejorCantidad = -1
  wb.eachSheet((ws) => {
    const filas: Celda[][] = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      const valores: Celda[] = []
      const n = row.cellCount
      for (let c = 1; c <= n; c++) {
        const cell = row.getCell(c)
        // Una celda combinada se lee una vez: ExcelJS repite el valor en todas
        // las de la combinación, y un título repetido parece un encabezado.
        valores.push(cell.isMerged && cell.master !== cell ? null : valorDeCelda(cell))
      }
      filas.push(valores)
    })
    const conDatos = filas.filter((f) => f.filter((v) => v !== null && v !== '').length >= 2).length
    if (conDatos > mejorCantidad) {
      mejorCantidad = conDatos
      mejor = { filas, hoja: ws.name }
    }
  })
  if (mejor.filas.length === 0) throw new Error('El archivo no tiene datos.')
  return mejor
}

function valorDeCelda(cell: { value?: unknown; text?: unknown }): Celda {
  const v = cell.value
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.result === 'number' || typeof o.result === 'string') return o.result
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((x) => x.text ?? '').join('')
    if (typeof o.text === 'string') return o.text
  }
  return typeof cell.text === 'string' ? cell.text : null
}

/** UTF-8 si es válido; si no, Windows-1252, que es lo que exporta Excel en castellano. */
async function decodificar(archivo: File): Promise<string> {
  const bytes = await archivo.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

// ── Base ─────────────────────────────────────────────────────────────────────

export interface MarcaDetectada {
  brandId: string
  marca: string
  coincidencias: number
}

/** Cuántas referencias (y modelos) del archivo existen en el catálogo de cada marca. */
export async function detectarMarcaPorReferencias(companyId: string, claves: string[]): Promise<MarcaDetectada[]> {
  if (claves.length === 0) return []
  const { data, error } = await supabase.rpc('listas_detectar_marca', {
    p_company_id: companyId,
    p_referencias: claves.slice(0, 20000),
  })
  if (error) throw new Error(`No se pudo detectar la marca: ${error.message}`)
  return (data ?? []).map((d) => ({ brandId: d.brand_id, marca: d.marca, coincidencias: d.coincidencias }))
}

export interface ResumenImportacion {
  versionId: string
  renglones: number
  cruzan: number
  conAnterior: number
  suben: number
  bajan: number
  iguales: number
  nuevas: number
  medianaPct: number | null
  versionAnterior: string | null
}

export interface DatosImportacion {
  companyId: string
  brandId: string
  fecha: string
  moneda: string
  ancla: string
  archivo: string
  nota: string | null
  renglones: readonly Renglon[]
}

const TANDA = 1000

/**
 * Carga la lista: prepara la versión (reemplaza si ya había una de esa marca,
 * fecha y columna), inserta los renglones en tandas y los cruza con el
 * catálogo. `alAvanzar` recibe cuántos renglones van.
 */
export async function importarLista(d: DatosImportacion, alAvanzar?: (hechos: number) => void): Promise<ResumenImportacion> {
  const prep = await supabase.rpc('listas_preparar_version', {
    p_company_id: d.companyId,
    p_brand_id: d.brandId,
    p_fecha: d.fecha,
    p_moneda: d.moneda,
    p_ancla: d.ancla,
    p_archivo: d.archivo,
    p_nota: d.nota,
  })
  if (prep.error) throw new Error(traducir(prep.error.message))
  const versionId = prep.data

  for (let i = 0; i < d.renglones.length; i += TANDA) {
    const tanda = d.renglones.slice(i, i + TANDA).map((r) => ({
      company_id: d.companyId,
      version_id: versionId,
      reference: r.reference,
      description: r.description,
      anchor: r.anchor,
      prices: r.prices,
    }))
    const { error } = await supabase.from('price_list_items').insert(tanda)
    if (error) throw new Error(`Se cortó en el renglón ${i + 1}: ${traducir(error.message)}. Volvé a importar: reemplaza lo cargado.`)
    alAvanzar?.(Math.min(i + TANDA, d.renglones.length))
  }

  const fin = await supabase.rpc('listas_cerrar_version', { p_version_id: versionId })
  if (fin.error) throw new Error(traducir(fin.error.message))
  const r = (fin.data ?? {}) as Record<string, unknown>
  const num = (k: string) => (typeof r[k] === 'number' ? r[k] : 0)
  return {
    versionId,
    renglones: num('renglones'),
    cruzan: num('cruzan'),
    conAnterior: num('conAnterior'),
    suben: num('suben'),
    bajan: num('bajan'),
    iguales: num('iguales'),
    nuevas: num('nuevas'),
    medianaPct: typeof r.medianaPct === 'number' ? r.medianaPct : null,
    versionAnterior: typeof r.versionAnterior === 'string' ? r.versionAnterior : null,
  }
}

function traducir(m: string): string {
  if (/row-level security|permission denied|42501/i.test(m)) return 'Sólo un administrador puede cargar listas de precios'
  if (m.includes('LISTA_MARCA_INVALIDA')) return 'Esa marca no es de esta empresa'
  return m
}
