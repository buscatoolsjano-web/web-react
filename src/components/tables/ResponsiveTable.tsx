import type { ReactNode } from 'react'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { deriveCard, resolveCell } from './deriveCard'
import type { Column } from './types'
import styles from './ResponsiveTable.module.css'

export interface ResponsiveTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  /** Clave estable por fila. Nunca el índice del array. */
  rowKey: (row: T) => string
  isLoading?: boolean
  emptyMessage?: string
  onRowClick?: (row: T) => void
  /** Acciones por fila (botones). Se pintan como última columna y al pie de la card. */
  actions?: (row: T) => ReactNode
  /**
   * Escape hatch: reemplaza por completo la card mobile de este módulo.
   * Existe para que un módulo con una card muy particular no tenga que
   * pelearse con el layout genérico. Ver ADR-008.
   */
  renderCard?: (row: T) => ReactNode
}

/**
 * Tabla en desktop/tablet, cards en mobile.
 *
 * Renderiza UNA sola de las dos vistas (no ambas ocultas con CSS), para no
 * duplicar el DOM en listados largos.
 */
export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  isLoading = false,
  emptyMessage = 'No hay datos para mostrar.',
  onRowClick,
  actions,
  renderCard,
}: ResponsiveTableProps<T>) {
  const isMobile = useIsMobile()

  if (isLoading) {
    return (
      <div className={styles.wrap}>
        <p className={styles.state}>Cargando…</p>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className={styles.wrap}>
        <p className={styles.state}>{emptyMessage}</p>
      </div>
    )
  }

  if (isMobile) {
    return (
      <div className={styles.cards}>
        {rows.map((row) => {
          const key = rowKey(row)
          if (renderCard) return <div key={key}>{renderCard(row)}</div>

          const card = deriveCard(columns, row)
          const Contenedor = onRowClick ? 'button' : 'div'

          return (
            <Contenedor
              key={key}
              className={styles.card}
              {...(onRowClick ? { type: 'button' as const, onClick: () => onRowClick(row) } : {})}
            >
              {card.title !== null && <div className={styles.cardTitle}>{card.title}</div>}
              <dl className={styles.cardFields}>
                {card.fields.map((f) => (
                  <div key={f.key}>
                    <dt className={styles.fieldLabel}>{f.label}</dt>
                    <dd className={styles.fieldValue}>{f.value}</dd>
                  </div>
                ))}
              </dl>
              {actions && <div className={styles.cardActions}>{actions(row)}</div>}
            </Contenedor>
          )
        })}
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.scroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={c.width ? { width: c.width } : undefined} className={alineacion(c.align)}>
                  {c.header}
                </th>
              ))}
              {actions && <th aria-label="Acciones" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={onRowClick ? styles.clickable : undefined}
                {...(onRowClick ? { onClick: () => onRowClick(row) } : {})}
              >
                {columns.map((c) => (
                  <td key={c.key} className={alineacion(c.align)}>
                    {resolveCell(c, row) as ReactNode}
                  </td>
                ))}
                {actions && <td>{actions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function alineacion(align: Column<unknown>['align']): string | undefined {
  if (align === 'right') return styles.alignRight
  if (align === 'center') return styles.alignCenter
  return undefined
}
