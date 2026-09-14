import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cx } from '@/utils/cx'
import { Icon, type IconName } from '@/components/icons/Icon'
import { Spinner } from './Spinner'
import styles from './IconButton.module.css'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  icon: IconName
  /** Obligatorio: es el único nombre accesible del botón. */
  'aria-label': string
  variant?: 'ghost' | 'secondary' | 'danger' | undefined
  size?: 'sm' | 'md' | undefined
  loading?: boolean | undefined
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, variant = 'ghost', size = 'md', loading = false, className, type = 'button', disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(styles.boton, styles[variant], styles[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      title={rest['aria-label']}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : <Icon name={icon} size={size === 'sm' ? 16 : 20} />}
    </button>
  )
})
