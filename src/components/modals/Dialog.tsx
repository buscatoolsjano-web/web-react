import { useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '@/utils/cx'
import { IconButton } from '@/components/ui/IconButton'
import { enfocables, useModalAccesible } from './useModalAccesible'
import styles from './Dialog.module.css'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** Texto breve bajo el título; se conecta con `aria-describedby`. */
  description?: ReactNode | undefined
  children?: ReactNode | undefined
  /** Botones del pie (el primario a la derecha). */
  footer?: ReactNode | undefined
  /** 'xl' es para trabajar adentro del diálogo —una tabla, un catálogo—, no para leer. */
  size?: 'sm' | 'md' | 'lg' | 'xl' | undefined
  /** `alertdialog` para confirmaciones destructivas. */
  role?: 'dialog' | 'alertdialog' | undefined
  /** Elemento que recibe el foco al abrir. Por defecto: el primer control del cuerpo, o el diálogo. */
  initialFocusRef?: RefObject<HTMLElement | null> | undefined
  /** Mientras se guarda: no se cierra con Escape, fondo ni «Cerrar». */
  busy?: boolean | undefined
  /** Cerrar tocando el fondo. Desactivar en formularios con cambios. */
  closeOnOverlay?: boolean | undefined
  /** Botón «Cerrar» (X) en el encabezado. */
  showClose?: boolean | undefined
  className?: string | undefined
}

/**
 * Diálogo modal accesible.
 *
 * - `role="dialog"`/`alertdialog`, `aria-modal`, `aria-labelledby` y `aria-describedby`.
 * - Foco inicial dentro, Tab/Shift+Tab atrapados, Escape cierra, el foco
 *   vuelve al elemento que lo abrió.
 * - El resto de la app queda `inert` y sin scroll mientras está abierto.
 * - En pantallas < 768px se muestra como hoja inferior a ancho completo.
 */
export function Dialog(props: DialogProps) {
  if (!props.open) return null
  return <DialogAbierto {...props} />
}

function DialogAbierto({
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  role = 'dialog',
  initialFocusRef,
  busy = false,
  closeOnOverlay = true,
  showClose = true,
  className,
}: DialogProps) {
  const idTitulo = useId()
  const idDesc = useId()
  const caja = useRef<HTMLDivElement>(null)
  const cuerpo = useRef<HTMLDivElement>(null)
  useModalAccesible(caja, {
    onClose,
    busy,
    initialFocus: () => initialFocusRef?.current ?? (cuerpo.current ? enfocables(cuerpo.current)[0] : null),
  })

  return createPortal(
    <div
      className={styles.fondo}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && closeOnOverlay && !busy) onClose()
      }}
    >
      <div
        ref={caja}
        role={role}
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={description ? idDesc : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className={cx(styles.caja, styles[size], className)}
      >
        <header className={styles.encabezado}>
          <div className={styles.titulos}>
            <h2 id={idTitulo} className={styles.titulo}>
              {title}
            </h2>
            {description && (
              <p id={idDesc} className={styles.descripcion}>
                {description}
              </p>
            )}
          </div>
          {showClose && <IconButton icon="x" aria-label="Cerrar" onClick={onClose} disabled={busy} className={styles.cerrar} />}
        </header>
        {children && (
          <div ref={cuerpo} className={styles.cuerpo}>
            {children}
          </div>
        )}
        {footer && <footer className={styles.pie}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
