import type { ReactNode } from 'react'
import { cx } from '@/utils/cx'
import { Icon } from '@/components/icons/Icon'
import { LinkButton } from '@/components/ui/LinkButton'
import styles from './Document.module.css'

export interface ActionBarProps {
  /** Vuelta al listado. Sólo tiene sentido en una barra pegada: el enlace del encabezado se va con el scroll. */
  volver?: { to: string; label: string } | undefined
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
  /**
   * La barra queda a la vista al bajar por el documento (Fase 28 · E3).
   *
   * No es `fixed` ni flota sobre el contenido: es `sticky` justo debajo del
   * header, con fondo propio. El bug viejo era una barra que tapaba las
   * líneas; ésta ocupa su lugar en el flujo y ahí se queda.
   */
  pegajosa?: boolean | undefined
  label?: string | undefined
  className?: string | undefined
}

/**
 * Barra de acciones de un documento.
 *
 * Va en el flujo de la página, debajo del encabezado. Con `pegajosa` se pega
 * abajo del header al bajar por el documento: en una cotización de treinta
 * líneas, «Guardar» estaba a dos pantallas de la línea que se acababa de
 * tocar.
 */
export function ActionBar({
  volver,
  primary,
  secondary,
  more,
  danger,
  note,
  pegajosa,
  label = 'Acciones del documento',
  className,
}: ActionBarProps) {
  if (!volver && !primary && !secondary && !more && !danger && !note) return null
  return (
    <div
      className={cx(styles.actionBar, pegajosa && styles.actionBarPegajosa, className)}
      role="group"
      aria-label={label}
    >
      {(volver || primary || secondary || more || danger) && (
        <div className={styles.actionFila}>
          {volver && (
            <LinkButton to={volver.to} variant="secondary" icon={<Icon name="arrow-left" size={16} />}>
              {volver.label}
            </LinkButton>
          )}
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
