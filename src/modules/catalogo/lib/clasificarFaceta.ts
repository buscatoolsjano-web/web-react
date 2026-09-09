import type { FacetaAtributo, OpcionFaceta } from '../types'

/**
 * Cuántos valores distintos hasta los cuales conviene elegir de una lista.
 *
 * Por encima de eso, si además TODOS los valores son numéricos, un rango
 * min/máx es mejor que una lista de 176 opciones.
 */
export const MAX_OPCIONES_ENUM = 12

const NUMERICO = /^-?\d+(?:[.,]\d+)?$/

function aNumero(v: string): number | null {
  if (!NUMERICO.test(v.trim())) return null
  const n = Number(v.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Decide si un atributo se filtra con lista o con rango, mirando los datos.
 *
 * La regla no se aplica por tipo declarado, y esa distinción importa:
 *
 *  - `rpm` está declarado `number` en la base, pero 22 de sus 24 valores son
 *    intervalos de texto (`0-2600`, `50-800`). Un rango numérico daría
 *    resultados falsos, así que va como lista.
 *  - `medida` tiene 258 valores y sólo 71 son numéricos: mezcla métrico
 *    (`10`), imperial (`1/2"`) y calibres (`#2`). Tampoco puede ser rango.
 *  - `largo` sí: 176 valores, todos numéricos, de 3 a 600 mm.
 *
 * Por eso la condición para rango es doble: muchos valores Y todos
 * numéricos. Si aparece uno solo que no lo sea, vuelve a ser lista.
 */
export function clasificarFaceta(
  key: string,
  label: string,
  unidad: string | null,
  valores: readonly { value: string; count: number }[],
): FacetaAtributo {
  const opciones: OpcionFaceta[] = valores.map((v) => ({
    valor: v.value,
    etiqueta: v.value,
    cantidad: v.count,
  }))

  const numeros = valores.map((v) => aNumero(v.value))
  const todosNumericos = numeros.length > 0 && numeros.every((n) => n !== null)
  const esRango = valores.length > MAX_OPCIONES_ENUM && todosNumericos

  if (!esRango) {
    return { key, label, unidad, clase: 'enum', opciones, min: null, max: null }
  }

  const validos = numeros.filter((n): n is number => n !== null)
  return {
    key,
    label,
    unidad,
    clase: 'range',
    // Las opciones se conservan aunque sea rango: sirven para mostrar los
    // extremos reales y para contar cuántos productos hay en total.
    opciones,
    min: Math.min(...validos),
    max: Math.max(...validos),
  }
}

/**
 * ¿Vale la pena dibujar la faceta de subcategoría?
 *
 * No, en dos casos, y ninguno se decide nombrando categorías:
 *
 *  - no hay ningún subtipo (`otros`, 12.588 productos sin `product_type`);
 *  - hay uno solo y repite el nombre de la categoría (`balanceador` →
 *    «Balanceador», `llave-dinamometrica` → «Llave dinamométrica»). Un único
 *    hijo con el nombre del padre no divide nada.
 */
export function mostrarFacetaSubtipo(
  subtipos: readonly OpcionFaceta[],
  nombreCategoria: string | null,
): boolean {
  if (subtipos.length === 0) return false
  if (subtipos.length > 1) return true
  if (nombreCategoria === null) return true
  const unico = subtipos[0]
  if (!unico) return false
  return !mismoTexto(unico.valor, nombreCategoria)
}

/**
 * Compara ignorando mayúsculas y acentos.
 *
 * Se usa localeCompare con sensitivity 'base' en vez de una regex sobre
 * marcas combinantes: hace lo mismo y no deja caracteres invisibles en el
 * código fuente.
 */
function mismoTexto(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), 'es', { sensitivity: 'base' }) === 0
}
