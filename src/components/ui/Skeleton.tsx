import { cx } from '@/utils/cx'
import styles from './Skeleton.module.css'

export interface SkeletonProps {
  /** Ancho CSS (p. ej. '60%', '8rem'). */
  width?: string | undefined
  height?: string | undefined
  radius?: 'sm' | 'md' | 'full' | undefined
  className?: string | undefined
}

/** Bloque de carga con la forma del contenido final. Decorativo. */
export function Skeleton({ width = '100%', height = '1em', radius = 'sm', className }: SkeletonProps) {
  return <span className={cx(styles.skeleton, styles[radius], className)} style={{ width, height }} aria-hidden="true" />
}

export interface SkeletonRowsProps {
  rows?: number | undefined
  columns?: number | undefined
  /** Texto para lectores de pantalla mientras carga. */
  label?: string | undefined
}

/** Filas de tabla/listado en carga: mantiene el alto para que la página no salte. */
export function SkeletonRows({ rows = 5, columns = 4, label = 'Cargando…' }: SkeletonRowsProps) {
  return (
    <div className={styles.filas} role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, f) => (
        <div key={f} className={styles.fila}>
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} width={c === 0 ? '40%' : `${60 + ((f + c) % 3) * 12}%`} />
          ))}
        </div>
      ))}
    </div>
  )
}
