import type { ReactNode } from 'react'
import { cx } from '@/utils/cx'
import { Icon, type IconName } from '@/components/icons/Icon'
import styles from './Alert.module.css'

export type AlertTone = 'info' | 'warning' | 'danger' | 'success' | 'neutral'

const ICONO: Record<AlertTone, IconName> = {
  info: 'info',
  warning: 'alert-triangle',
  danger: 'alert-circle',
  success: 'check-circle',
  neutral: 'info',
}

export interface AlertProps {
  tone?: AlertTone | undefined
  title?: ReactNode | undefined
  children?: ReactNode | undefined
  /**
   * `alert` para un error que aparece por una acción (se anuncia), `status`
   * para un resultado, `note` para un aviso permanente de la pantalla.
   */
  role?: 'alert' | 'status' | 'note' | undefined
  /** Acción opcional a la derecha (p. ej. «Reintentar»). */
  action?: ReactNode | undefined
  className?: string | undefined
  'data-testid'?: string | undefined
}

/**
 * Aviso del sistema: el mismo cuadro para STEL, revisión, error, advertencia
 * y éxito. Siempre ícono + texto (nunca sólo color).
 */
export function Alert({ tone = 'info', title, children, role = 'note', action, className, ...rest }: AlertProps) {
  return (
    <div className={cx(styles.alert, styles[tone], className)} role={role} data-testid={rest['data-testid']}>
      <Icon name={ICONO[tone]} size={20} className={styles.icono} />
      <div className={styles.cuerpo}>
        {title && <p className={styles.titulo}>{title}</p>}
        {children && <div className={styles.texto}>{children}</div>}
      </div>
      {action && <div className={styles.accion}>{action}</div>}
    </div>
  )
}
