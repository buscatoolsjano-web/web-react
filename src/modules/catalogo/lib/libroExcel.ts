import type { DataValidation } from 'exceljs'
import { columnasDeHoja, type RolColumna } from './planExcel'
import type { DefinicionAtributo, ProductoListado } from '../types'

/**
 * El Excel del catálogo, guiado y por categoría (Fase 126).
 *
 * UNA HOJA POR CATEGORÍA: cada hoja trae las columnas base más los atributos
 * propios de esa categoría (Balanceadores: Min/Max kg; Puntas y tubos: Medida,
 * Largo, Encastre). Así cada producto queda con sus columnas para completar.
 *
 * Tres columnas son DESPLEGABLES, para que no se dupliquen ni se escriban mal:
 *   · Categoría y Marca, con lista cerrada de los valores reales de la web
 *     (una hoja oculta «Listas» guarda los nombres y las celdas la referencian);
 *   · Tipo, como sugerencia blanda de los tipos ya usados en esa categoría.
 *
 * ExcelJS se importa de forma dinámica —pesa, y sólo hace falta al exportar—.
 */

export interface MetadatosExcel {
  /** Todas las categorías de la web, para el desplegable (evita duplicados). */
  categorias: { id: string; nombre: string }[]
  /** Todos los nombres de marca, para el desplegable. */
  marcas: string[]
  /** categoryId → claves de atributo que aplican (product_attribute_categories). */
  atributosPorCategoria: Map<string, Set<string>>
  definiciones: DefinicionAtributo[]
}

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
/** Por encima de esto no se ponen validaciones por celda, para no reventar. */
const TOPE_VALIDACIONES = 5000

export async function construirLibroExcel(
  productos: readonly ProductoListado[],
  elegidas: ReadonlySet<string>,
  opciones: { esInterno: boolean; moneda: string | null },
  meta: MetadatosExcel,
): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ctx = { moneda: opciones.moneda }

  // ── Hoja oculta con las listas de los desplegables ──
  const listas = wb.addWorksheet('Listas')
  listas.state = 'veryHidden'
  listas.getCell('A1').value = 'Categorías'
  meta.categorias.forEach((c, i) => { listas.getCell(`A${i + 2}`).value = c.nombre })
  listas.getCell('B1').value = 'Marcas'
  meta.marcas.forEach((m, i) => { listas.getCell(`B${i + 2}`).value = m })
  const refCategorias = meta.categorias.length ? `'Listas'!$A$2:$A$${meta.categorias.length + 1}` : null
  const refMarcas = meta.marcas.length ? `'Listas'!$B$2:$B$${meta.marcas.length + 1}` : null

  // ── Una hoja por categoría ──
  const grupos = agruparPorCategoria(productos)
  const usados = new Set<string>()
  for (const grupo of grupos) {
    const attrs = grupo.catId === SIN_CATEGORIA ? [] : [...(meta.atributosPorCategoria.get(grupo.catId) ?? [])]
    const cols = columnasDeHoja(elegidas, opciones.esInterno, attrs, meta.definiciones)
    const ws = wb.addWorksheet(nombreHojaUnico(grupo.nombre, usados))

    ws.addRow(cols.map((c) => c.etiqueta))
    ws.getRow(1).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    for (const p of grupo.items) ws.addRow(cols.map((c) => c.valor(p, ctx)))

    const tipos = distintos(grupo.items.map((p) => p.tipo ?? '').filter((t) => t !== ''))
    const nFilas = grupo.items.length
    cols.forEach((col, i) => {
      ws.getColumn(i + 1).width = anchoDe(col.rol)
      if (nFilas === 0 || nFilas > TOPE_VALIDACIONES) return
      const dv = validacionDe(col.rol, refCategorias, refMarcas, tipos)
      if (!dv) return
      for (let r = 2; r <= nFilas + 1; r++) ws.getCell(r, i + 1).dataValidation = dv
    })
  }

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], { type: MIME_XLSX })
}

const SIN_CATEGORIA = '__sin__'

function agruparPorCategoria(productos: readonly ProductoListado[]) {
  const mapa = new Map<string, { catId: string; nombre: string; items: ProductoListado[] }>()
  for (const p of productos) {
    const catId = p.categoria?.id ?? SIN_CATEGORIA
    const nombre = p.categoria?.nombre ?? 'Sin categoría'
    const g = mapa.get(catId) ?? { catId, nombre, items: [] }
    g.items.push(p)
    mapa.set(catId, g)
  }
  return [...mapa.values()]
}

/** Nombre de hoja válido para Excel: sin caracteres prohibidos, ≤31, único. */
function nombreHojaUnico(nombre: string, usados: Set<string>): string {
  const base = (nombre.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Hoja').slice(0, 28)
  let candidato = base
  let n = 2
  while (usados.has(candidato.toLowerCase())) candidato = `${base} ${n++}`.slice(0, 31)
  usados.add(candidato.toLowerCase())
  return candidato
}

function distintos(xs: readonly string[]): string[] {
  return [...new Set(xs)]
}

function anchoDe(rol: RolColumna): number {
  switch (rol) {
    case 'id': return 20
    case 'base': return 30
    case 'categoria': return 22
    case 'marca': return 18
    case 'tipo': return 18
    case 'atributo': return 14
    case 'stock': return 12
  }
}

/** La validación (desplegable) de una columna, o `null` si no lleva. */
function validacionDe(
  rol: RolColumna,
  refCategorias: string | null,
  refMarcas: string | null,
  tipos: readonly string[],
): DataValidation | null {
  if (rol === 'categoria' && refCategorias) {
    return {
      type: 'list', allowBlank: true, formulae: [refCategorias],
      showErrorMessage: true, errorStyle: 'stop',
      errorTitle: 'Categoría', error: 'Elegí una categoría de la lista para no duplicarlas.',
    }
  }
  if (rol === 'marca' && refMarcas) {
    return {
      type: 'list', allowBlank: true, formulae: [refMarcas],
      showErrorMessage: true, errorStyle: 'stop',
      errorTitle: 'Marca', error: 'Elegí una marca de la lista para no duplicarlas.',
    }
  }
  if (rol === 'tipo' && tipos.length > 0) {
    // Inline y BLANDO: sugiere los tipos ya usados pero deja escribir uno nuevo.
    // Un tipo con coma rompería la lista inline, y >250 no entra: en esos casos,
    // sin desplegable (el tipo no tiene tabla maestra como categoría o marca).
    const inline = tipos.join(',')
    if (!tipos.some((t) => t.includes(',')) && inline.length <= 250) {
      return { type: 'list', allowBlank: true, formulae: [`"${inline}"`], showErrorMessage: false }
    }
  }
  return null
}
