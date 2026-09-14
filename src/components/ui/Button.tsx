import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from '@/utils/cx'
import { Spinner } from './Spinner'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant | undefined
  /** `sm` sólo para grillas densas de escritorio: en pantallas táctiles sube a 44px igual. */
  size?: ButtonSize | undefined
  block?: boolean | undefined
  /** Deshabilita, anuncia `aria-busy` y muestra un spinner sin cambiar el texto. */
  loading?: boolean | undefined
  /** Ícono antes del texto (decorativo). */
  icon?: ReactNode | undefined
}

/**
 * Botón del sistema. Una sola acción `primary` por vista.
 *
 * Compatible con el uso de Fase 1 (`variant` primary/secondary/ghost, `block`).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block = false, loading = false, icon, className, type = 'button', disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(styles.btn, styles[variant], styles[size], block && styles.block, loading && styles.loading, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={16} className={styles.spinner} /> : icon && <span className={styles.icon} aria-hidden="true">{icon}</span>}
      {children}
    </button>
  )
})
