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
 * No, en tres casos, y ninguno se decide nombrando categorías:
 *
 *  1. No hay ningún subtipo. Es `otros`: 12.588 productos con
 *     `product_type` vacío, el 57,8 % del catálogo.
 *
 *  2. No se eligió categoría y tampoco hay subtipos activos. Sin categoría
 *     la faceta trae los 40 subtipos del catálogo entero, una pared de chips
 *     que empuja todo lo demás fuera de la pantalla. Se muestra recién
 *     cuando hay un contexto donde significan algo — igual que en la web
 *     anterior. La excepción de "subtipos activos" existe para que un link
 *     compartido con `?tipo=Gatillo` y sin categoría siga siendo editable.
 *
 *  3. Hay un solo subtipo Y cubre TODOS los resultados. Elegirlo devolvería
 *     exactamente lo mismo que ya se está viendo: no divide nada. Es el caso
 *     de `balanceador` → «Balanceador» (376 de 376) y de
 *     `llave-dinamometrica` → «Llave dinamométrica» (2 de 2).
 *
 *     La regla mira los CONTEOS y no los nombres. Comparar nombres fallaba:
 *     la categoría se llama «Balanceadores» y el subtipo «Balanceador», así
 *     que en plural contra singular no coincidían y la faceta se dibujaba
 *     igual. El conteo no tiene ese problema, y además cubre casos donde el
 *     nombre no se parece en nada.
 */
export function mostrarFacetaSubtipo(
  subtipos: readonly OpcionFaceta[],
  total: number,
  hayCategoriaElegida: boolean,
  subtiposElegidos: readonly string[] = [],
): boolean {
  if (subtipos.length === 0) return false
  // Si hay un subtipo elegido la faceta se muestra SIEMPRE, o no habría
  // forma de quitarlo: al filtrar por él pasa a cubrir el 100 % de los
  // resultados y la regla de abajo lo escondería, dejándolo trabado.
  if (subtiposElegidos.length > 0) return true
  if (!hayCategoriaElegida) return false
  if (subtipos.length === 1) {
    const unico = subtipos[0]
    if (unico && unico.cantidad >= total) return false
  }
  return true
}
