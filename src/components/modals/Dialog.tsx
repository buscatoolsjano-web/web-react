import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '@/utils/cx'
import { IconButton } from '@/components/ui/IconButton'
import styles from './Dialog.module.css'

const ENFOCABLES = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function enfocables(raiz: HTMLElement): HTMLElement[] {
  return [...raiz.querySelectorAll<HTMLElement>(ENFOCABLES)].filter((e) => !e.closest('[inert]') && e.getAttribute('aria-hidden') !== 'true')
}

// Pila de diálogos abiertos: sólo el de arriba responde a Escape y atrapa el
// foco; el bloqueo de scroll y el `inert` del fondo se liberan con el último.
const pila: symbol[] = []

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** Texto breve bajo el título; se conecta con `aria-describedby`. */
  description?: ReactNode | undefined
  children?: ReactNode | undefined
  /** Botones del pie (el primario a la derecha). */
  footer?: ReactNode | undefined
  size?: 'sm' | 'md' | 'lg' | undefined
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
  const clave = useRef(Symbol('dialog'))
  // Refs para que los efectos de montaje no se re-ejecuten con cada render.
  const cerrar = useRef(onClose)
  const ocupado = useRef(busy)
  useEffect(() => {
    cerrar.current = onClose
    ocupado.current = busy
  })

  // Montaje: pila, foco inicial, inert + scroll lock, retorno del foco.
  useEffect(() => {
    const yo = clave.current
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const raizApp = document.getElementById('root')
    pila.push(yo)
    if (pila.length === 1) {
      raizApp?.setAttribute('inert', '')
      document.body.dataset.dialogScroll = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }

    const destino = initialFocusRef?.current ?? (cuerpo.current && enfocables(cuerpo.current)[0]) ?? caja.current
    destino?.focus()

    return () => {
      const i = pila.indexOf(yo)
      if (i >= 0) pila.splice(i, 1)
      if (pila.length === 0) {
        raizApp?.removeAttribute('inert')
        document.body.style.overflow = document.body.dataset.dialogScroll ?? ''
        delete document.body.dataset.dialogScroll
      }
      if (previo?.isConnected) previo.focus()
    }
    // Sólo al montar/desmontar: el foco inicial no debe moverse en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Teclado a nivel documento: funciona aunque el foco haya caído en el fondo.
  useEffect(() => {
    const alTeclado = (e: KeyboardEvent) => {
      if (pila[pila.length - 1] !== clave.current || !caja.current) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (!ocupado.current) cerrar.current()
        return
      }
      if (e.key !== 'Tab') return
      const lista = enfocables(caja.current)
      const activo = document.activeElement
      if (lista.length === 0) {
        e.preventDefault()
        caja.current.focus()
        return
      }
      const primero = lista[0]!
      const ultimo = lista[lista.length - 1]!
      const fuera = !caja.current.contains(activo)
      if (e.shiftKey && (fuera || activo === primero || activo === caja.current)) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && (fuera || activo === ultimo)) {
        e.preventDefault()
        primero.focus()
      }
    }
    document.addEventListener('keydown', alTeclado)
    return () => document.removeEventListener('keydown', alTeclado)
  }, [])

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
