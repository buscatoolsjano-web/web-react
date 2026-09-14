import type { ReactNode } from 'react'
import { cx } from '@/utils/cx'
import { Icon, type IconName } from '@/components/icons/Icon'
import styles from './Feedback.module.css'

export interface EmptyStateProps {
  title: string
  /** Una línea: qué es o por qué está vacío («sin datos» ≠ «sin resultados para estos filtros»). */
  description?: ReactNode | undefined
  icon?: IconName | undefined
  /** CTA si el rol puede crear, o «Limpiar filtros». */
  action?: ReactNode | undefined
  /** Nivel del título según el lugar donde se usa. */
  headingLevel?: 1 | 2 | 3 | undefined
  compact?: boolean | undefined
  className?: string | undefined
}

export function EmptyState({ title, description, icon, action, headingLevel = 2, compact = false, className }: EmptyStateProps) {
  const Titulo = headingLevel === 1 ? 'h1' : headingLevel === 2 ? 'h2' : 'h3'
  return (
    <div className={cx(styles.estado, compact && styles.compacto, className)}>
      {icon && (
        <span className={styles.icono}>
          <Icon name={icon} size={32} />
        </span>
      )}
      <Titulo className={styles.titulo}>{title}</Titulo>
      {description && <p className={styles.descripcion}>{description}</p>}
      {action && <div className={styles.accion}>{action}</div>}
    </div>
  )
}
