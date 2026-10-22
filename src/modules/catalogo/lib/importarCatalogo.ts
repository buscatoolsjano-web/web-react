import { COLUMNAS_EXPORTABLES } from './exportar'
import type { DefinicionAtributo } from '../types'

/**
 * Importar un catálogo para ACTUALIZAR (Fase 111).
 *
 * «Si yo exporto una base de datos quiero poder importarla con los atributos o
 * la información modificada, que se actualice correctamente.» El archivo es el
 * mismo CSV que produce el export (separador `;`, UTF-8 con BOM, CRLF), así que
 * exportás, editás en Excel y volvés a subir.
 *
 * Esta parte es PURA: parsea el texto, detecta qué columnas trae y arma los
 * cambios por fila. No toca la red ni la base. Así la lógica delicada —la que
 * decide qué se actualiza y a qué campo— se prueba sin montar nada. Resolver
 * nombres de marca/categoría a ids y escribir en la base es trabajo del service.
 *
 * Reglas (decididas con el usuario):
 *   · el match es por **Referencia (SKU)**; un SKU que no existe se informa y
 *     NO se crea nada (importar = actualizar, no dar de alta);
 *   · se detectan TODAS las columnas del archivo y el usuario puede destildar
 *     las que no quiera aplicar;
 *   · stock, moneda y «en catálogo» no se importan (son derivados o se manejan
 *     aparte); se muestran como no aplicables.
 */

/** A dónde va cada columna del archivo. */
export type DestinoColumna =
  | { tipo: 'match' } // Referencia: la llave, no se aplica como cambio
  | { tipo: 'campo'; campo: 'name' | 'series' | 'product_type' }
  | { tipo: 'marca' } // se resuelve el nombre a brand_id
  | { tipo: 'categoria' } // se resuelve el nombre a category_id
  | { tipo: 'atributo'; key: string }
  | { tipo: 'ignorada'; motivo: string }

export interface ColumnaDetectada {
  /** El encabezado tal cual vino en el archivo. */
  encabezado: string
  /** La clave interna (sku, nombre, medida, voltaje…). */
  clave: string
  /** La etiqueta para mostrar. */
  etiqueta: string
  destino: DestinoColumna
  /** `true` si el usuario puede elegir aplicarla o no. La Referencia y las
      ignoradas no son elegibles. */
  elegible: boolean
}

export interface FilaImportada {
  /** 1-based, para los mensajes de error («fila 42»). */
  numero: number
  sku: string
  /** Valor por clave de columna, ya sin comillas de CSV. */
  valores: Record<string, string>
}

export interface CatalogoParseado {
  columnas: ColumnaDetectada[]
  filas: FilaImportada[]
  /** Encabezados que no se reconocieron (se ignoran, se avisan). */
  desconocidas: string[]
  /** `true` si falta la columna Referencia, sin la cual no se puede matchear. */
  sinReferencia: boolean
}

const SEP = ';'

/**
 * Parsea un CSV con las convenciones del ERP: separador `;`, campos entre
 * comillas con `""` escapado, CRLF o LF, y BOM al inicio. Hecho a mano y no con
 * una librería: es un formato acotado y propio, y una dependencia para leer
 * `;`-separado es peso que no se paga.
 */
export function parsearCsv(texto: string): { encabezados: string[]; filas: string[][] } {
  const limpio = texto.replace(/^\uFEFF/, '')
  const filas: string[][] = []
  let campo = ''
  let fila: string[] = []
  let enComillas = false
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i]
    if (enComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') { campo += '"'; i++ } else enComillas = false
      } else campo += c
    } else if (c === '"') {
      enComillas = true
    } else if (c === SEP) {
      fila.push(campo); campo = ''
    } else if (c === '\n') {
      fila.push(campo); campo = ''; filas.push(fila); fila = []
    } else if (c === '\r') {
      // fin de línea CRLF: el \n que sigue cierra la fila
    } else campo += c
  }
  // Último campo/fila si el archivo no termina en salto de línea.
  if (campo !== '' || fila.length > 0) { fila.push(campo); filas.push(fila) }
  // Filas totalmente vacías (una línea en blanco al final) se descartan.
  const noVacias = filas.filter((f) => f.some((x) => x.trim() !== ''))
  if (noVacias.length === 0) return { encabezados: [], filas: [] }
  const encabezados = (noVacias[0] ?? []).map((h) => h.trim())
  return { encabezados, filas: noVacias.slice(1) }
}

/** etiqueta del export (normalizada) → clave interna. */
const POR_ETIQUETA = new Map(COLUMNAS_EXPORTABLES.map((c) => [norm(c.etiqueta), c.clave]))
const CLAVE_EXPORT = new Map(COLUMNAS_EXPORTABLES.map((c) => [c.clave, c]))

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

/** El destino de una clave interna ya reconocida. */
function destinoDeClave(clave: string, defsPorKey: Map<string, DefinicionAtributo>): DestinoColumna {
  switch (clave) {
    case 'sku': return { tipo: 'match' }
    case 'nombre': return { tipo: 'campo', campo: 'name' }
    case 'serie': return { tipo: 'campo', campo: 'series' }
    case 'tipo': return { tipo: 'campo', campo: 'product_type' }
    case 'marca': return { tipo: 'marca' }
    case 'categoria': return { tipo: 'categoria' }
    case 'precio': return { tipo: 'ignorada', motivo: 'El precio lo administra STEL (es el maestro); la importación no lo pisa porque el próximo sync lo sobrescribiría.' }
    case 'moneda': return { tipo: 'ignorada', motivo: 'La moneda es la de la lista activa; no se importa.' }
    case 'stock_real':
    case 'stock_virtual': return { tipo: 'ignorada', motivo: 'El stock se maneja por movimientos, no por importación.' }
    case 'en_catalogo': return { tipo: 'ignorada', motivo: 'Se decide por la marca y la categoría activas.' }
    default:
      // Cualquier otra clave que sea un atributo declarado.
      if (defsPorKey.has(clave)) return { tipo: 'atributo', key: clave }
      return { tipo: 'ignorada', motivo: 'Columna no reconocida.' }
  }
}

/**
 * Detecta qué columna es cada encabezado. Reconoce las etiquetas del export y,
 * además, cualquier atributo declarado por su etiqueta o su clave —así una
 * columna «Voltaje» que el export no incluye igual se puede importar.
 */
export function detectarColumnas(
  encabezados: readonly string[],
  definiciones: readonly DefinicionAtributo[],
): { columnas: ColumnaDetectada[]; desconocidas: string[]; sinReferencia: boolean } {
  const defsPorKey = new Map(definiciones.map((d) => [d.key, d]))
  const defPorEtiqueta = new Map(definiciones.map((d) => [norm(d.label), d]))
  const columnas: ColumnaDetectada[] = []
  const desconocidas: string[] = []
  const vistas = new Set<string>()

  for (const h of encabezados) {
    const n = norm(h)
    // 1) etiqueta conocida del export
    let clave = POR_ETIQUETA.get(n)
    // 2) atributo declarado por etiqueta o por su clave cruda
    if (!clave) {
      const def = defPorEtiqueta.get(n) ?? defsPorKey.get(h.trim())
      if (def) clave = def.key
    }
    if (!clave || vistas.has(clave)) {
      if (!clave) desconocidas.push(h)
      continue // una columna repetida se ignora: aplicar dos veces la misma es ambiguo
    }
    vistas.add(clave)
    const destino = destinoDeClave(clave, defsPorKey)
    const etiqueta = CLAVE_EXPORT.get(clave)?.etiqueta ?? defsPorKey.get(clave)?.label ?? h
    columnas.push({
      encabezado: h,
      clave,
      etiqueta,
      destino,
      elegible: destino.tipo !== 'match' && destino.tipo !== 'ignorada',
    })
  }
  return { columnas, desconocidas, sinReferencia: !vistas.has('sku') }
}

/** Arma las filas con sus valores por clave, listas para aplicar. */
export function parsearCatalogo(
  texto: string,
  definiciones: readonly DefinicionAtributo[],
): CatalogoParseado {
  const { encabezados, filas } = parsearCsv(texto)
  const { columnas, desconocidas, sinReferencia } = detectarColumnas(encabezados, definiciones)
  const idxSku = encabezados.findIndex((h) => POR_ETIQUETA.get(norm(h)) === 'sku')
  const idxPorClave = columnas.map((c) => ({ clave: c.clave, idx: encabezados.indexOf(c.encabezado) }))

  const out: FilaImportada[] = []
  filas.forEach((f, i) => {
    const sku = idxSku >= 0 ? (f[idxSku] ?? '').trim() : ''
    if (sku === '') return // sin referencia no se puede matchear; se saltea
    const valores: Record<string, string> = {}
    for (const { clave, idx } of idxPorClave) valores[clave] = (f[idx] ?? '').trim()
    out.push({ numero: i + 2, sku, valores }) // +2: fila 1 es el encabezado
  })

  return { columnas, filas: out, desconocidas, sinReferencia }
}
