import type { ReactNode } from 'react'

/**
 * Cómo se comporta una columna en la vista mobile (cards).
 *  - 'title'  → es el encabezado de la card (ej. "PEDIDO #1524"). Máximo una.
 *  - 'hide'   → no aparece en mobile (columnas de relleno, IDs internos).
 *  - 'field'  → par etiqueta/valor dentro de la card. Es el default.
 */
export type MobileRole = 'title' | 'hide' | 'field'

export interface Column<T> {
  /** Identificador estable. Se usa como key de React. */
  key: string
  /** Encabezado en desktop y etiqueta del campo en mobile. */
  header: string
  /** Cómo se pinta la celda. Si falta, se usa `String(row[key])`. */
  render?: (row: T) => ReactNode
  align?: 'left' | 'center' | 'right'
  /** Ancho CSS de la columna en desktop (ej. '120px', '20%'). */
  width?: string
  /**
   * Qué clase de dato lleva, para darle un ancho de arranque sensato
   * (Fase 58 · E6). Sólo lo usan las tablas con `anchosAjustables`: una fecha
   * no necesita lo mismo que un nombre, y repartir todo en partes iguales deja
   * unas columnas enormes y otras ilegibles. Sin esto se usa la alineación
   * como pista. Ver `anchoDeColumnas.ts`.
   */
  tipo?: 'texto' | 'numero' | 'fecha' | 'codigo' | 'estado' | undefined
  /** Rol en la card mobile. Default: 'field'. */
  mobile?: MobileRole
  /**
   * Prioridad en la tabla (Fase 13 · E6). Una columna secundaria se oculta
   * debajo de un ancho: 'xl' debajo de 1280px, 'lg' debajo de 1024px. El dato
   * no se pierde: la página lo repite dentro de una columna esencial en esos
   * anchos, y la card mobile sigue mostrando todas las columnas.
   */
  hideBelow?: 'lg' | 'xl' | undefined
}

/** Un par etiqueta/valor ya resuelto para pintar en la card. */
export interface CardField {
  key: string
  label: string
  value: ReactNode
}

/** Contenido de una card mobile derivado de las columnas. */
export interface CardModel {
  title: ReactNode | null
  fields: CardField[]
}
