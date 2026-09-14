import type { ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { cx } from '@/utils/cx'
import type { ButtonSize, ButtonVariant } from './Button'
import styles from './Button.module.css'

export interface LinkButtonProps extends LinkProps {
  variant?: ButtonVariant | undefined
  size?: ButtonSize | undefined
  icon?: ReactNode | undefined
}

/** Un enlace de navegación con aspecto de botón («Nueva cotización», «Cancelar»). */
export function LinkButton({ variant = 'secondary', size = 'md', icon, className, children, ...rest }: LinkButtonProps) {
  return (
    <Link className={cx(styles.btn, styles[variant], styles[size], styles.enlace, className)} {...rest}>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </Link>
  )
}
