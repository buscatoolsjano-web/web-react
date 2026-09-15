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
