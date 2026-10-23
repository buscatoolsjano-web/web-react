import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { construirLibroExcel, type MetadatosExcel } from './libroExcel'
import { parsearExcel } from './importarExcel'
import type { DefinicionAtributo, ProductoListado } from '../types'

const defs: DefinicionAtributo[] = [
  { key: 'min_kg', label: 'Min kg' } as DefinicionAtributo,
  { key: 'max_kg', label: 'Max kg' } as DefinicionAtributo,
  { key: 'medida', label: 'Medida' } as DefinicionAtributo,
]

const meta: MetadatosExcel = {
  categorias: [
    { id: 'bal', nombre: 'Balanceadores' },
    { id: 'pt', nombre: 'Puntas y tubos' },
  ],
  marcas: ['APEX', 'SPEEDRILL'],
  atributosPorCategoria: new Map([
    ['bal', new Set(['min_kg', 'max_kg'])],
    ['pt', new Set(['medida'])],
  ]),
  definiciones: defs,
}

const prod = (over: Partial<ProductoListado>): ProductoListado =>
  ({
    id: 'id-x', sku: 'SKU-X', nombre: 'Algo', marca: { id: 'm', nombre: 'APEX' },
    categoria: null, serie: '', tipo: '', atributos: {}, precio: null, stock: null, enCatalogo: true,
    ...over,
  } as unknown as ProductoListado)

const productos: ProductoListado[] = [
  prod({ id: 'id-1', sku: 'BAL.1', categoria: { id: 'bal', nombre: 'Balanceadores', slug: 'bal' }, atributos: { min_kg: '1', max_kg: '5' } }),
  prod({ id: 'id-2', sku: 'PT.1', categoria: { id: 'pt', nombre: 'Puntas y tubos', slug: 'pt' }, atributos: { medida: '13mm' } }),
]

async function leer(blob: Blob): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await blob.arrayBuffer())
  return wb
}
const encabezadosDe = (ws: ExcelJS.Worksheet) => (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ''))

describe('construirLibroExcel (Fase 126)', () => {
  it('hace una hoja por categoría, con el ID interno primero y los atributos propios de cada una', async () => {
    const blob = await construirLibroExcel(productos, new Set(['sku']), { esInterno: true, moneda: 'USD' }, meta)
    const wb = await leer(blob)

    const hojas = wb.worksheets.map((w) => w.name)
    expect(hojas).toContain('Balanceadores')
    expect(hojas).toContain('Puntas y tubos')
    // La hoja de listas está pero oculta.
    expect(wb.getWorksheet('Listas')?.state).toBe('veryHidden')

    const bal = encabezadosDe(wb.getWorksheet('Balanceadores')!)
    const pt = encabezadosDe(wb.getWorksheet('Puntas y tubos')!)
    expect(bal[0]).toBe('ID interno')
    // Balanceadores tiene Min/Max kg; Puntas no (tiene Medida).
    expect(bal).toEqual(expect.arrayContaining(['Min kg', 'Max kg']))
    expect(bal).not.toContain('Medida')
    expect(pt).toContain('Medida')
    expect(pt).not.toContain('Min kg')
  })

  it('la columna Categoría lleva un desplegable (data validation de lista)', async () => {
    const blob = await construirLibroExcel(productos, new Set(['sku']), { esInterno: true, moneda: 'USD' }, meta)
    const wb = await leer(blob)
    const bal = wb.getWorksheet('Balanceadores')!
    const encs = encabezadosDe(bal)
    const colCat = encs.indexOf('Categoría') + 1
    const dv = bal.getCell(2, colCat).dataValidation
    expect(dv?.type).toBe('list')
  })

  it('round-trip: el Excel generado se vuelve a importar y matchea por ID interno', async () => {
    const blob = await construirLibroExcel(productos, new Set(['sku', 'nombre']), { esInterno: true, moneda: 'USD' }, meta)
    const parseado = await parsearExcel(await blob.arrayBuffer(), defs)

    // Las dos filas, con su id capturado (se puede re-importar tras cambiar SKU).
    expect(parseado.filas).toHaveLength(2)
    expect(parseado.filas.map((f) => f.id).sort()).toEqual(['id-1', 'id-2'])
    expect(parseado.sinReferencia).toBe(false)
    // La unión de columnas detecta los atributos de ambas categorías.
    const claves = parseado.columnas.map((c) => c.clave)
    expect(claves).toEqual(expect.arrayContaining(['id', 'sku', 'min_kg', 'max_kg', 'medida']))
  })
})
