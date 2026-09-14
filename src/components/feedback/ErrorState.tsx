import type { ReactNode } from 'react'
import { cx } from '@/utils/cx'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import styles from './Feedback.module.css'

export interface ErrorStateProps {
  /** Mensaje humano. Nunca un stacktrace ni el `error.message` crudo de la base. */
  title: string
  description?: ReactNode | undefined
  onRetry?: (() => void) | undefined
  retrying?: boolean | undefined
  compact?: boolean | undefined
  className?: string | undefined
}

/** Error de panel o de página, con «Reintentar». Se anuncia con `role="alert"`. */
export function ErrorState({ title, description, onRetry, retrying = false, compact = false, className }: ErrorStateProps) {
  return (
    <div className={cx(styles.estado, styles.error, compact && styles.compacto, className)} role="alert">
      <span className={styles.iconoError}>
        <Icon name="alert-triangle" size={compact ? 24 : 32} />
      </span>
      <p className={styles.titulo}>{title}</p>
      {description && <p className={styles.descripcion}>{description}</p>}
      {onRetry && (
        <div className={styles.accion}>
          <Button variant="secondary" onClick={onRetry} loading={retrying}>
            Reintentar
          </Button>
        </div>
      )}
    </div>
  )
}
