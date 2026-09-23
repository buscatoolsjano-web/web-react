import type { FacetaAtributo, ProductoListado } from '../types'

/**
 * Las columnas que aparecen al elegir una categoría (Fase 22 · paridad, #19).
 *
 * El legacy tiene un mapa fijo, `CATEGORY_FILTERS` (app.js:15086): al elegir
 * «Puntas y Tubos» agrega Medida, Largo y Encastre como columnas de la tabla;
 * con «Balanceador», Min kg, Max kg, Carcasa, Longitud y Eslinga. Sin
 * categoría, ninguna.
 *
 * Acá no hace falta un mapa: **las facetas ya dicen qué atributos tiene la
 * categoría que se está mirando**, con su etiqueta y su unidad, y salen de los
 * datos reales en vez de una lista escrita a mano que envejece. Es la misma
 * capacidad —ver el atributo distintivo de un vistazo, sin abrir la ficha—
 * con una fuente mejor.
 *
 * Tres límites, y los tres son para que la tabla siga siendo legible:
 *
 *   · sólo con categoría elegida, como el legacy;
 *   · un máximo de columnas, porque una familia con doce atributos deja la
 *     tabla imposible de leer y con scroll horizontal;
 *   · se descartan los atributos que casi nadie tiene: una columna vacía en
 *     el 95 % de las filas ocupa lugar y no informa.
 */

/** El legacy muestra hasta 5 (balanceadores). Acá es el mismo techo. */
export const MAXIMO_COLUMNAS = 5

/**
 * Cuántos productos de la categoría tienen que tener el atributo.
 *
 * Con menos, la columna es casi toda «—». No es un umbral fino: es la
 * diferencia entre «este atributo describe a la familia» y «lo tienen tres».
 */
export const COBERTURA_MINIMA = 0.25

export interface ColumnaDinamica {
  key: string
  label: string
  unidad: string | null
}

export function columnasDinamicas(
  categoriaElegida: string | null,
  atributos: readonly FacetaAtributo[],
  totalDeLaCategoria: number,
): ColumnaDinamica[] {
  if (!categoriaElegida || totalDeLaCategoria === 0) return []

  return atributos
    .filter((a) => {
      // `opciones` trae el conteo por valor: la suma es cuántos productos
      // tienen el atributo cargado.
      const conDato = a.opciones.reduce((n, o) => n + o.cantidad, 0)
      const cubre = a.clase === 'range' ? true : conDato / totalDeLaCategoria >= COBERTURA_MINIMA
      return cubre
    })
    .slice(0, MAXIMO_COLUMNAS)
    .map((a) => ({ key: a.key, label: a.label, unidad: a.unidad }))
}

/** El valor que va en la celda, con su unidad. `—` si el producto no lo tiene. */
export function valorDinamico(p: ProductoListado, col: ColumnaDinamica): string {
  const v: unknown = p.atributos?.[col.key]
  // Sólo escalares. `attributes` es jsonb: un objeto mal cargado se muestra
  // como «—» en vez de «[object Object]», que en una tabla no es un dato.
  const texto =
    typeof v === 'string' ? v.trim()
    : typeof v === 'number' || typeof v === 'boolean' ? String(v)
    : ''
  if (texto === '') return '—'
  // Si el valor ya trae la unidad escrita no se la duplica: «2 m m» no.
  if (!col.unidad || /[a-z]/i.test(texto.replace(/^[\d.,\s/]+/, ''))) return texto
  return `${texto} ${col.unidad}`
}
