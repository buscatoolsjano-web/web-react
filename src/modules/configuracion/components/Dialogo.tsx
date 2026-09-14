import { useEffect, useId, useRef, type ReactNode } from 'react'
import styles from './Configuracion.module.css'

export interface DialogoProps {
  titulo: string
  children: ReactNode
  /** Botones del pie. */
  pie: ReactNode
  onCerrar: () => void
  /** Mientras se guarda no se cierra con Escape ni tocando afuera. */
  bloqueado?: boolean
}

/** Diálogo modal accesible: foco adentro, Escape cierra, fondo cierra. */
export function Dialogo({ titulo, children, pie, onCerrar, bloqueado = false }: DialogoProps) {
  const idTitulo = useId()
  const caja = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null
    const primero = caja.current?.querySelector<HTMLElement>('input, select, textarea, button')
    primero?.focus()
    return () => previo?.focus()
  }, [])

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !bloqueado) onCerrar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [bloqueado, onCerrar])

  return (
    <div
      className={styles.fondo}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !bloqueado) onCerrar()
      }}
    >
      <div ref={caja} className={styles.caja} role="dialog" aria-modal="true" aria-labelledby={idTitulo}>
        <h2 id={idTitulo} className={styles.dialogoTitulo}>
          {titulo}
        </h2>
        {children}
        <div className={styles.pie}>{pie}</div>
      </div>
    </div>
  )
}
