import type { ReactNode } from 'react'
import { cx } from '@/utils/cx'
import styles from './Document.module.css'

export interface ActionBarProps {
  /** La acción principal del estado actual (una). */
  primary?: ReactNode | undefined
  /** Acciones normales: editar, imprimir, enviar… */
  secondary?: ReactNode | undefined
  /** Acciones poco frecuentes, dentro de «Más ▾». Nunca la principal del workflow. */
  more?: ReactNode | undefined
  /** Acciones destructivas, separadas a la derecha. */
  danger?: ReactNode | undefined
  /** Motivos de bloqueo, avisos o resultado (texto visible, no tooltip). */
  note?: ReactNode | undefined
  label?: string | undefined
  className?: string | undefined
}

/**
 * Barra de acciones de un documento.
 *
 * Va en el flujo de la página, debajo del encabezado: nunca `fixed` ni
 * `sticky` sobre el contenido (era el bug de la barra que tapaba las líneas).
 */
export function ActionBar({ primary, secondary, more, danger, note, label = 'Acciones del documento', className }: ActionBarProps) {
  if (!primary && !secondary && !more && !danger && !note) return null
  return (
    <div className={cx(styles.actionBar, className)} role="group" aria-label={label}>
      {(primary || secondary || more || danger) && (
        <div className={styles.actionFila}>
          {primary && <div className={styles.actionPrimaria}>{primary}</div>}
          {secondary && <div className={styles.actionGrupo}>{secondary}</div>}
          {more && <div className={styles.actionGrupo}>{more}</div>}
          {danger && <div className={cx(styles.actionGrupo, styles.actionPeligro)}>{danger}</div>}
        </div>
      )}
      {note && <div className={styles.actionNota}>{note}</div>}
    </div>
  )
}
