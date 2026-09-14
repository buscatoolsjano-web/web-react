import { cx } from '@/utils/cx'
import styles from './Spinner.module.css'

export interface SpinnerProps {
  size?: 16 | 20 | 24 | 32 | undefined
  /** Si se da, se anuncia a lectores de pantalla; si no, es decorativo. */
  label?: string | undefined
  className?: string | undefined
}

export function Spinner({ size = 20, label, className }: SpinnerProps) {
  return (
    <span
      className={cx(styles.spinner, className)}
      style={{ width: size, height: size }}
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
    />
  )
}
