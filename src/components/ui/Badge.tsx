import type { ReactNode } from 'react'
import { cx } from '@/utils/cx'
import styles from './Badge.module.css'

export type BadgeTone = 'neutral' | 'info' | 'brand' | 'success' | 'warning' | 'danger'

export interface BadgeProps {
  tone?: BadgeTone | undefined
  children: ReactNode
  /** Punto delante del texto: refuerza el estado sin depender sólo del color. */
  dot?: boolean | undefined
  /** Contorno sin relleno (p. ej. «Cancelado»). */
  outline?: boolean | undefined
  className?: string | undefined
}

/**
 * Estado con texto. El módulo decide el mapeo negocio → tono
 * (p. ej. `confirmed → brand`); el Badge sólo pinta.
 */
export function Badge({ tone = 'neutral', children, dot = false, outline = false, className }: BadgeProps) {
  return (
    <span className={cx(styles.badge, styles[tone], outline && styles.outline, className)}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  )
}
