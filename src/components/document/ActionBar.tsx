import type { ReactNode } from 'react'
import { cx } from '@/utils/cx'
import styles from './Document.module.css'

export interface ActionBarProps {
  /** La acción principal del estado actual (una). */
  primary?: ReactNode | undefined
  /** Acciones normales: editar, imprimir, duplicar… */
  secondary?: ReactNode | undefined
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
export function ActionBar({ primary, secondary, danger, note, label = 'Acciones del documento', className }: ActionBarProps) {
  if (!primary && !secondary && !danger && !note) return null
  return (
    <div className={cx(styles.actionBar, className)} role="group" aria-label={label}>
      {(primary || secondary || danger) && (
        <div className={styles.actionFila}>
          {primary && <div className={styles.actionPrimaria}>{primary}</div>}
          {secondary && <div className={styles.actionGrupo}>{secondary}</div>}
          {danger && <div className={cx(styles.actionGrupo, styles.actionPeligro)}>{danger}</div>}
        </div>
      )}
      {note && <div className={styles.actionNota}>{note}</div>}
    </div>
  )
}
