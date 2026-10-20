import type { FacetaAtributoPublica } from '../services/catalogoPublico'

/**
 * Qué columnas de atributo aparecen (Fase 87 · E2c). PURO.
 *
 * ── LA MISMA REGLA QUE EL ERP, Y POR LAS MISMAS RAZONES ─────────────────────
 *
 * El catálogo interno agrega columnas según la categoría elegida —«Puntas y
 * tubos» trae Encastre, Medida, Largo y Sufijos— con tres límites, y los tres
 * son para que la tabla siga siendo legible:
 *
 *   · sólo con categoría elegida: sin ella, los atributos de ocho familias
 *     distintas no comparten ninguna columna y quedarían casi todas vacías;
 *   · un máximo, porque una familia con doce atributos deja una tabla que no
 *     entra en ninguna pantalla;
 *   · se descarta lo que casi nadie tiene: una columna vacía en el 95 % de
 *     las filas ocupa lugar y no informa.
 *
 * Esto es esa misma regla para el catálogo público. Se escribe de nuevo —y no
 * se importa de `catalogo/lib/columnasDinamicas`— porque las facetas públicas
 * tienen otra forma: las internas traen `clase` y rangos, que acá no existen.
 * Lo que se comparte de verdad son los números, que están abajo y se leen.
 */

/** El mismo techo que el legacy y que el catálogo interno. */
export const MAXIMO_COLUMNAS = 5

/**
 * Cuántos productos de lo que se está mirando tienen que tener el atributo.
 *
 * No es un umbral fino: es la diferencia entre «este atributo describe a la
 * familia» y «lo tienen tres».
 */
export const COBERTURA_MINIMA = 0.25

export interface ColumnaAtributo {
  key: string
  label: string
  unidad: string | null
  opciones: readonly { valor: string; cuantos: number }[]
}

export function columnasDeAtributo(
  categoriaElegida: string | null | undefined,
  atributos: readonly FacetaAtributoPublica[],
  total: number,
): ColumnaAtributo[] {
  if (!categoriaElegida || total === 0) return []

  return atributos
    .filter((a) => a.cubiertos / total >= COBERTURA_MINIMA)
    .slice(0, MAXIMO_COLUMNAS)
    .map((a) => ({
      key: a.key,
      label: a.label,
      unidad: a.unidad,
      opciones: a.opciones,
    }))
}

/**
 * El valor que va en la celda, con su unidad. `—` si el producto no lo tiene.
 *
 * Si el valor ya trae la unidad escrita no se la duplica: «2 m m» no. Es la
 * misma regla que `valorDinamico` del catálogo interno, y sale del mismo
 * problema: los datos vienen de varios catálogos de proveedor y algunos
 * escriben la unidad adentro del valor.
 */
export function valorDeAtributo(
  atributos: Record<string, unknown> | null | undefined,
  columna: { key: string; unidad: string | null },
): string {
  const v: unknown = atributos?.[columna.key]
  const texto =
    typeof v === 'string' ? v.trim()
    : typeof v === 'number' || typeof v === 'boolean' ? String(v)
    : Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(', ')
    : ''

  if (texto === '') return '—'
  if (!columna.unidad || /[a-z]/i.test(texto.replace(/^[\d.,\s/]+/, ''))) return texto
  return `${texto} ${columna.unidad}`
}
