import { useId, useState, type ReactNode } from 'react'
import { cx } from '@/utils/cx'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import styles from './FilterBar.module.css'

export interface FilterBarProps {
  /** Búsqueda: siempre visible, también en mobile. */
  search?: ReactNode | undefined
  /** El resto de los filtros. */
  children?: ReactNode | undefined
  /** Filtros aplicados además de la búsqueda (para el contador en mobile). */
  activeCount?: number | undefined
  /** Si se da y hay filtros, aparece «Limpiar filtros». */
  onClear?: (() => void) | undefined
  hasFilters?: boolean | undefined
  label?: string | undefined
  className?: string | undefined
}

/**
 * Barra de filtros: SÓLO layout. Cada módulo pone sus propios controles y su
 * propia lógica (estado en la URL, debounce, valores); esto no la toca.
 *
 * - ≥ 768px: una fila que envuelve, la búsqueda ocupa el espacio que sobra.
 * - < 768px: búsqueda arriba y el resto plegado detrás de «Filtros (n)».
 */
export function FilterBar({ search, children, activeCount = 0, onClear, hasFilters = false, label = 'Filtros', className }: FilterBarProps) {
  const isMobile = useIsMobile()
  const [abierta, setAbierta] = useState(false)
  const idPanel = useId()
  const mostrar = !isMobile || abierta

  return (
    <div className={cx(styles.barra, className)} role="search" aria-label={label}>
      {search && <div className={styles.busqueda}>{search}</div>}
      {isMobile && children ? (
        <Button
          variant="secondary"
          className={styles.plegar}
          aria-expanded={abierta}
          aria-controls={idPanel}
          onClick={() => setAbierta((v) => !v)}
          icon={<Icon name="filter" size={16} />}
        >
          {abierta ? 'Ocultar filtros' : 'Filtros'}
          {activeCount > 0 ? (
            <span className={styles.contador}>
              {activeCount}
              <span className="sr-only"> aplicados</span>
            </span>
          ) : null}
        </Button>
      ) : null}
      {children ? (
        <div id={idPanel} className={styles.filtros} hidden={!mostrar}>
          {children}
          {onClear && hasFilters ? (
            <Button variant="ghost" onClick={onClear} className={styles.limpiar} icon={<Icon name="x" size={16} />}>
              Limpiar filtros
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
