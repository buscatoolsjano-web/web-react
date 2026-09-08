import type { CardModel, Column } from './types'

/**
 * Resuelve el valor de una celda: usa `render` si existe, si no cae al
 * valor crudo de la fila. Un valor nulo o vacío se muestra como '—',
 * igual que en el sistema legacy.
 */
export function resolveCell<T>(column: Column<T>, row: T): unknown {
  if (column.render) return column.render(row)

  const valor = (row as Record<string, unknown>)[column.key]
  if (valor === null || valor === undefined || valor === '') return '—'
  return valor
}

/**
 * Convierte las columnas de la tabla en el modelo de una card mobile.
 *
 * Esta es la única traducción desktop→mobile del sistema: se define una
 * vez por tabla y se reutiliza. Un módulo que necesite una card distinta
 * pasa `renderCard` y esto no se ejecuta.
 *
 * Si ninguna columna se marca como 'title', se usa la primera visible,
 * para que la card nunca quede sin encabezado.
 */
export function deriveCard<T>(columns: Column<T>[], row: T): CardModel {
  const visibles = columns.filter((c) => c.mobile !== 'hide')

  const columnaTitulo = visibles.find((c) => c.mobile === 'title') ?? visibles[0]

  const fields = visibles
    .filter((c) => c.key !== columnaTitulo?.key)
    .map((c) => ({
      key: c.key,
      label: c.header,
      value: resolveCell(c, row) as CardModel['fields'][number]['value'],
    }))

  return {
    title: columnaTitulo ? (resolveCell(columnaTitulo, row) as CardModel['title']) : null,
    fields,
  }
}
