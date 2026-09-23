import { importe, numero, texto } from '@/modules/informes/lib/csv'
import type { ProductoListado } from '../types'

/**
 * Exportar el catálogo (Fase 22 · paridad, #49).
 *
 * El legacy (`app.js:16960` el modal, `:17010` el archivo) deja elegir:
 *
 *   · el **alcance**: los filtrados o todo el catálogo;
 *   · las **columnas**, agrupadas en «Información básica», «Atributos
 *     técnicos» y «Stock y precio», con «todas» y «ninguna»;
 *   · y muestra en vivo cuántos productos y cuántas columnas van.
 *
 * Y tiene dos reglas de permiso que se replican tal cual (`:16999`): un
 * cliente **nunca** exporta stock virtual, y **nunca** exporta el catálogo
 * entero, sólo lo que filtró.
 *
 * El formato es CSV. Se reutiliza la sanitización de Informes —`texto()`
 * antepone `'` a lo que empieza con `=`, `+`, `-`, `@`, tabulación o
 * retorno— porque un catálogo tiene nombres de producto escritos a mano y
 * ahí es donde entra una fórmula.
 */

export type GrupoColumna = 'base' | 'atributos' | 'stock'

export interface ColumnaExportable {
  clave: string
  etiqueta: string
  grupo: GrupoColumna
  /** Sólo para roles internos; un cliente no la ve ni puede pedirla. */
  soloInterno?: boolean
  valor: (p: ProductoListado, contexto: { moneda: string | null }) => string
}

/**
 * Un atributo del jsonb.
 *
 * El valor es `unknown`: `attributes` es texto libre y puede traer un número,
 * una cadena o —si alguien cargó mal— un objeto. Sólo se exportan los
 * escalares; un objeto se deja vacío en vez de escribir «[object Object]»,
 * que en una planilla no le sirve a nadie.
 */
const atributo = (clave: string) => (p: ProductoListado) => {
  const v: unknown = p.atributos?.[clave]
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return texto(v)
  if (typeof v === 'number' || typeof v === 'boolean') return texto(String(v))
  return ''
}

/**
 * Las columnas, en el orden del legacy.
 *
 * Son las mismas 27 menos las que React no tiene como dato propio —`familia`,
 * `huella` y `eslinga` no existen en `products` ni en los atributos cargados—
 * y más `en_catalogo`, que en el legacy no existía porque tampoco existía el
 * concepto de marca inactiva.
 */
export const COLUMNAS_EXPORTABLES: ColumnaExportable[] = [
  { clave: 'sku', etiqueta: 'Referencia', grupo: 'base', valor: (p) => texto(p.sku) },
  { clave: 'marca', etiqueta: 'Marca', grupo: 'base', valor: (p) => texto(p.marca?.nombre ?? '') },
  { clave: 'nombre', etiqueta: 'Descripción', grupo: 'base', valor: (p) => texto(p.nombre) },
  { clave: 'categoria', etiqueta: 'Categoría', grupo: 'base', valor: (p) => texto(p.categoria?.nombre ?? '') },
  { clave: 'serie', etiqueta: 'Serie', grupo: 'base', valor: (p) => texto(p.serie ?? '') },
  { clave: 'tipo', etiqueta: 'Tipo', grupo: 'atributos', valor: (p) => texto(p.tipo ?? '') },
  { clave: 'medida', etiqueta: 'Medida', grupo: 'atributos', valor: atributo('medida') },
  { clave: 'largo', etiqueta: 'Largo (mm)', grupo: 'atributos', valor: atributo('largo') },
  { clave: 'encastre', etiqueta: 'Encastre', grupo: 'atributos', valor: atributo('encastre') },
  { clave: 'min_kg', etiqueta: 'Min kg', grupo: 'atributos', valor: atributo('min_kg') },
  { clave: 'max_kg', etiqueta: 'Max kg', grupo: 'atributos', valor: atributo('max_kg') },
  { clave: 'longitud', etiqueta: 'Longitud cable', grupo: 'atributos', valor: atributo('longitud') },
  { clave: 'carcasa', etiqueta: 'Carcasa', grupo: 'atributos', valor: atributo('carcasa') },
  { clave: 'torq_min', etiqueta: 'Torque mínimo', grupo: 'atributos', valor: atributo('torq_min') },
  { clave: 'torq_max', etiqueta: 'Torque máximo', grupo: 'atributos', valor: atributo('torq_max') },
  {
    clave: 'stock_real',
    etiqueta: 'Stock real',
    grupo: 'stock',
    soloInterno: true,
    // «Sin saldo registrado» no es cero, ni acá ni en la pantalla (F21 · E3.1).
    valor: (p) => (p.stock ? numero(p.stock.real) : ''),
  },
  {
    clave: 'stock_virtual',
    etiqueta: 'Stock virtual',
    grupo: 'stock',
    soloInterno: true,
    valor: (p) => (p.stock ? numero(p.stock.virtual) : ''),
  },
  { clave: 'precio', etiqueta: 'Precio', grupo: 'stock', valor: (p) => importe(p.precio) },
  { clave: 'moneda', etiqueta: 'Moneda', grupo: 'stock', valor: (_p, c) => texto(c.moneda ?? 'SIN MONEDA') },
  {
    clave: 'en_catalogo',
    etiqueta: 'En catálogo',
    grupo: 'base',
    valor: (p) => (p.enCatalogo ? 'si' : 'no'),
  },
]

export const ETIQUETA_GRUPO: Record<GrupoColumna, string> = {
  base: 'Información básica',
  atributos: 'Atributos técnicos',
  stock: 'Stock y precio',
}

/** Las que puede pedir este rol. El filtro es de datos, no de pantalla. */
export function columnasPara(esInterno: boolean): ColumnaExportable[] {
  return COLUMNAS_EXPORTABLES.filter((c) => esInterno || !c.soloInterno)
}

/** Las elegidas por omisión: todo lo básico y el precio, como el legacy. */
export function columnasPorDefecto(esInterno: boolean): Set<string> {
  return new Set(
    columnasPara(esInterno)
      .filter((c) => c.grupo === 'base' || c.clave === 'precio' || c.clave === 'moneda')
      .map((c) => c.clave),
  )
}

export const SEPARADOR = ';'
export const FIN_DE_LINEA = '\r\n'

/**
 * El archivo.
 *
 * Mismas convenciones que el resto del ERP: separador `;`, CRLF y UTF-8 con
 * BOM, que es lo que abre bien el Excel en español. El BOM lo agrega quien
 * descarga, no esta función, para que los tests comparen texto y no bytes.
 */
export function catalogoACsv(
  productos: readonly ProductoListado[],
  elegidas: ReadonlySet<string>,
  opciones: { esInterno: boolean; moneda: string | null },
): string {
  const cols = columnasPara(opciones.esInterno).filter((c) => elegidas.has(c.clave))
  if (cols.length === 0) return ''
  const contexto = { moneda: opciones.moneda }
  const cabecera = cols.map((c) => texto(c.etiqueta)).join(SEPARADOR)
  const filas = productos.map((p) => cols.map((c) => c.valor(p, contexto)).join(SEPARADOR))
  return [cabecera, ...filas].join(FIN_DE_LINEA)
}

/** `catalogo_buscatools_2026-09-23.csv`, como el legacy. */
export function nombreDeArchivo(hoy = new Date()): string {
  return `catalogo_buscatools_${hoy.toISOString().slice(0, 10)}.csv`
}
