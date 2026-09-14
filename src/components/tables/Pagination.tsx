import { cx } from '@/utils/cx'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { rangoTexto, type Sustantivo } from './rango'
import styles from './Pagination.module.css'

export type { Sustantivo }

export interface PaginationProps {
  /** Filas salteadas (0, 50, 100…). */
  offset: number
  pageSize: number
  total: number
  noun: Sustantivo
  onChange: (offset: number) => void
  /** Deshabilita mientras llega la página nueva. */
  loading?: boolean | undefined
  /** Nombre accesible de la región (útil si hay dos listados en la pantalla). */
  label?: string | undefined
  className?: string | undefined
}

/**
 * Paginación por desplazamiento: rango + Anterior/Siguiente.
 *
 * El rango se anuncia con `aria-live` para que el cambio de página se oiga.
 */
export function Pagination({ offset, pageSize, total, noun, onChange, loading = false, label = 'Paginación', className }: PaginationProps) {
  const hayAnterior = offset > 0
  const haySiguiente = offset + pageSize < total
  return (
    <nav className={cx(styles.pagination, className)} aria-label={label}>
      <p className={styles.rango} aria-live="polite">
        {rangoTexto(offset, pageSize, total, noun)}
      </p>
      {(hayAnterior || haySiguiente) && (
        <div className={styles.botones}>
          <Button variant="secondary" size="sm" onClick={() => onChange(Math.max(0, offset - pageSize))} disabled={!hayAnterior || loading} icon={<Icon name="chevron-left" size={16} />}>
            Anterior
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onChange(offset + pageSize)} disabled={!haySiguiente || loading} className={styles.siguiente}>
            Siguiente
            <Icon name="chevron-right" size={16} />
          </Button>
        </div>
      )}
    </nav>
  )
}
