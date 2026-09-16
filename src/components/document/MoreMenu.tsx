import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import styles from './Document.module.css'

export interface MoreMenuProps {
  /** Los botones de las acciones poco frecuentes. */
  children: ReactNode
  label?: string | undefined
}

/**
 * «Más ▾»: las acciones secundarias que no merecen ocupar la barra.
 *
 * Es un desplegable (`aria-expanded`), no un `role="menu"`: adentro van los
 * mismos `Button` que en la barra, con su propio nombre accesible y su propio
 * estado deshabilitado. Un `role="menu"` obligaría a que cada hijo fuera un
 * `menuitem` y rompería eso sin ganar nada.
 *
 * Nunca lleva la acción principal del workflow: esa va siempre visible, aunque
 * esté bloqueada.
 */
export function MoreMenu({ children, label = 'Más' }: MoreMenuProps) {
  const [abierto, setAbierto] = useState(false)
  const contenedor = useRef<HTMLDivElement>(null)
  const disparador = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!abierto) return

    const cerrarSiEsFuera = (e: MouseEvent) => {
      if (!contenedor.current?.contains(e.target as Node)) setAbierto(false)
    }
    // Escape cierra y devuelve el foco al botón: si no, el foco queda en un
    // elemento que ya no está y salta al principio de la página.
    const cerrarConEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setAbierto(false)
      disparador.current?.focus()
    }

    document.addEventListener('mousedown', cerrarSiEsFuera)
    document.addEventListener('keydown', cerrarConEscape)
    return () => {
      document.removeEventListener('mousedown', cerrarSiEsFuera)
      document.removeEventListener('keydown', cerrarConEscape)
    }
  }, [abierto])

  return (
    <div className={styles.mas} ref={contenedor}>
      <Button
        ref={disparador}
        variant="secondary"
        aria-expanded={abierto}
        aria-controls={id}
        onClick={() => setAbierto((v) => !v)}
      >
        {label}
        <Icon name="chevron-down" size={16} className={styles.masFlecha} />
      </Button>
      <div id={id} className={styles.masPanel} hidden={!abierto}>
        {children}
      </div>
    </div>
  )
}
