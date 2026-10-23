import { COLUMNAS_EXPORTABLES, ETIQUETA_ID } from './exportar'
import type { DefinicionAtributo, ProductoListado } from '../types'

/**
 * Qué columnas lleva la hoja de UNA categoría en la exportación a Excel (Fase 126).
 *
 * La gracia del Excel por categoría: cada hoja trae las columnas BASE más los
 * ATRIBUTOS PROPIOS de esa categoría. Balanceadores lleva Min/Max kg; Puntas y
 * tubos, Medida/Largo/Encastre. Así cada producto queda con sus columnas para
 * completar, y al importar se aplica lo que corresponde.
 *
 * Esto es puro —decide nombres y orden de columnas, y de dónde sale cada valor—
 * para poder probarlo sin ExcelJS. El armado del archivo (hojas, desplegables,
 * estilos) es imperativo y vive en `libroExcel.ts`.
 */

/** Para qué sirve cada columna: decide el desplegable y el ancho en el archivo. */
export type RolColumna = 'id' | 'base' | 'categoria' | 'marca' | 'tipo' | 'atributo' | 'stock'

export interface ColumnaExcel {
  clave: string
  etiqueta: string
  rol: RolColumna
  valor: (p: ProductoListado, ctx: { moneda: string | null }) => string
}

/** El valor de un atributo del jsonb como texto; un objeto o nulo sale vacío. */
function valorAtributo(p: ProductoListado, key: string): string {
  const v: unknown = p.atributos?.[key]
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

const EXPORT_POR_CLAVE = new Map(COLUMNAS_EXPORTABLES.map((c) => [c.clave, c]))

/**
 * El valor de cada columna conocida, como TEXTO PLANO (sin el escaping de CSV
 * que trae `COLUMNAS_EXPORTABLES.valor`, que en una celda de Excel se vería
 * literal). La etiqueta sí se reusa del export, para no tener dos nombres.
 */
const VALOR_PLANO: Record<string, (p: ProductoListado, ctx: { moneda: string | null }) => string> = {
  id: (p) => p.id,
  sku: (p) => p.sku,
  marca: (p) => p.marca?.nombre ?? '',
  nombre: (p) => p.nombre,
  categoria: (p) => p.categoria?.nombre ?? '',
  serie: (p) => p.serie ?? '',
  tipo: (p) => p.tipo ?? '',
  en_catalogo: (p) => (p.enCatalogo ? 'si' : 'no'),
  // «Sin saldo registrado» no es cero (F21 · E3.1).
  stock_real: (p) => (p.stock ? String(p.stock.real) : ''),
  stock_virtual: (p) => (p.stock ? String(p.stock.virtual) : ''),
  precio: (p) => (p.precio === null ? '' : String(p.precio)),
  moneda: (_p, ctx) => ctx.moneda ?? '',
}

/** El rol de cada columna base/stock conocida. */
const ROL: Record<string, RolColumna> = {
  sku: 'base', nombre: 'base', serie: 'base', en_catalogo: 'base',
  marca: 'marca', categoria: 'categoria', tipo: 'tipo',
  stock_real: 'stock', stock_virtual: 'stock', precio: 'stock', moneda: 'stock',
}

/**
 * Las identificatorias van SIEMPRE (son el esqueleto y las tres que llevan
 * desplegable): Referencia, Marca, Descripción, Categoría y Tipo. El resto de
 * las base y las de stock, sólo si se eligieron.
 */
const FIJAS = ['sku', 'marca', 'nombre', 'categoria', 'tipo'] as const
const OPCIONALES_BASE = ['serie', 'en_catalogo'] as const
const STOCK = ['stock_real', 'stock_virtual', 'precio', 'moneda'] as const

/**
 * Arma el orden de columnas de una hoja de categoría.
 *
 * @param atributosDeCategoria claves de atributo que aplican a la categoría
 *        (de `product_attribute_categories`), en el orden en que aparecen en
 *        `definiciones`.
 */
export function columnasDeHoja(
  elegidas: ReadonlySet<string>,
  esInterno: boolean,
  atributosDeCategoria: readonly string[],
  definiciones: readonly DefinicionAtributo[],
): ColumnaExcel[] {
  const defPorKey = new Map(definiciones.map((d) => [d.key, d]))
  const cols: ColumnaExcel[] = []

  // 1) El ID interno, siempre primero.
  cols.push({ clave: 'id', etiqueta: ETIQUETA_ID, rol: 'id', valor: VALOR_PLANO['id']! })

  // 2) Las identificatorias (siempre) y las base opcionales (si se eligieron).
  const base = [...FIJAS, ...OPCIONALES_BASE.filter((c) => elegidas.has(c))]
  for (const clave of base) {
    const def = EXPORT_POR_CLAVE.get(clave)
    const valor = VALOR_PLANO[clave]
    if (!def || !valor) continue
    cols.push({ clave, etiqueta: def.etiqueta, rol: ROL[clave] ?? 'base', valor })
  }

  // 3) Los atributos PROPIOS de la categoría, en el orden de `definiciones`.
  const orden = new Map(definiciones.map((d, i) => [d.key, i] as const))
  const claves = [...atributosDeCategoria].sort((a, b) => (orden.get(a) ?? 999) - (orden.get(b) ?? 999))
  for (const key of claves) {
    cols.push({
      clave: key,
      etiqueta: defPorKey.get(key)?.label ?? key,
      rol: 'atributo',
      valor: (p) => valorAtributo(p, key),
    })
  }

  // 4) Stock y precio, sólo los elegidos y permitidos por el rol.
  for (const clave of STOCK) {
    if (!elegidas.has(clave)) continue
    const def = EXPORT_POR_CLAVE.get(clave)
    const valor = VALOR_PLANO[clave]
    if (!def || !valor) continue
    if (def.soloInterno && !esInterno) continue
    cols.push({ clave, etiqueta: def.etiqueta, rol: 'stock', valor })
  }

  return cols
}
