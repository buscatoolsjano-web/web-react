import { useId } from 'react'
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
  /** Tamaños de página ofrecidos. Sin esto no se muestra el selector. */
  pageSizeOptions?: readonly number[] | undefined
  onPageSizeChange?: ((pageSize: number) => void) | undefined
  /** Nombre accesible de la región (útil si hay dos listados en la pantalla). */
  label?: string | undefined
  className?: string | undefined
}

/**
 * Paginación por desplazamiento: rango + (tamaño de página) + Anterior/Siguiente.
 *
 * El rango se anuncia con `aria-live` para que el cambio de página se oiga.
 */
export function Pagination({
  offset,
  pageSize,
  total,
  noun,
  onChange,
  loading = false,
  pageSizeOptions,
  onPageSizeChange,
  label = 'Paginación',
  className,
}: PaginationProps) {
  const idTamano = useId()
  const hayAnterior = offset > 0
  const haySiguiente = offset + pageSize < total
  const paginas = Math.max(1, Math.ceil(total / pageSize))
  const actual = Math.min(paginas, Math.floor(offset / pageSize) + 1)
  return (
    <nav className={cx(styles.pagination, className)} aria-label={label}>
      <p className={styles.rango} aria-live="polite">
        {rangoTexto(offset, pageSize, total, noun)}
      </p>
      {pageSizeOptions && onPageSizeChange ? (
        <div className={styles.tamano}>
          <label htmlFor={idTamano} className={styles.tamanoLabel}>
            Por página
          </label>
          <span className={styles.tamanoSelect}>
            <select id={idTamano} value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))} disabled={loading}>
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <Icon name="chevron-down" size={16} className={styles.tamanoFlecha} />
          </span>
        </div>
      ) : null}
      {(hayAnterior || haySiguiente) && (
        <div className={styles.botones}>
          <Button variant="secondary" size="sm" onClick={() => onChange(Math.max(0, offset - pageSize))} disabled={!hayAnterior || loading} icon={<Icon name="chevron-left" size={16} />}>
            Anterior
          </Button>
          <span className={styles.pagina}>
            Página {actual} de {paginas}
          </span>
          <Button variant="secondary" size="sm" onClick={() => onChange(offset + pageSize)} disabled={!haySiguiente || loading} className={styles.siguiente}>
            Siguiente
            <Icon name="chevron-right" size={16} />
          </Button>
        </div>
      )}
    </nav>
  )
}
