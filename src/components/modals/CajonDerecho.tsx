import { useRef, type ReactNode } from 'react'
import { Icon, type IconName } from '@/components/icons/Icon'
import { IconButton } from '@/components/ui/IconButton'
import { useModalAccesible } from './useModalAccesible'
import styles from './CajonDerecho.module.css'

/**
 * Un panel que entra por la derecha (Fase 33 · E2).
 *
 * Es un modal con otra forma, no otra cosa: reusa `useModalAccesible`, así que
 * atrapa el foco, cierra con Escape, deja el fondo `inert` y devuelve el foco
 * a quien lo abrió. Escribir eso de nuevo para «un panelcito» es cómo
 * aparecen las trampas de teclado.
 *
 * Va a la derecha y no al centro porque lo de adentro —el asistente, las
 * notificaciones— se consulta MIENTRAS se mira la pantalla de atrás. Un
 * diálogo centrado tapa justamente lo que uno está mirando.
 */
export interface CajonDerechoProps {
  titulo: string
  /** Una línea debajo del título, para decir qué es esto sin abrirlo. */
  subtitulo?: string
  /** Un ícono a la izquierda del título. */
  icono?: IconName
  onCerrar: () => void
  /** Más ancho para el asistente, que muestra conversación. */
  ancho?: 'normal' | 'ancho'
  /** Debajo del título, a la izquierda del botón de cerrar. */
  accion?: ReactNode
  children: ReactNode
}

export function CajonDerecho({
  titulo,
  subtitulo,
  icono,
  onCerrar,
  ancho = 'normal',
  accion,
  children,
}: CajonDerechoProps) {
  const caja = useRef<HTMLDivElement>(null)
  useModalAccesible(caja, { onClose: onCerrar })

  return (
    <div className={styles.velo} onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div
        ref={caja}
        className={ancho === 'ancho' ? `${styles.cajon} ${styles.cajonAncho}` : styles.cajon}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
      >
        <header className={styles.cabecera}>
          {icono ? (
            <span className={styles.icono} aria-hidden="true">
              <Icon name={icono} size={20} />
            </span>
          ) : null}
          <div className={styles.textos}>
            <h2 className={styles.titulo}>{titulo}</h2>
            {/* El subtítulo dice QUÉ es esto. Un panel titulado sólo
                «Asistente» obliga a probarlo para saber qué sabe. */}
            {subtitulo ? <p className={styles.subtitulo}>{subtitulo}</p> : null}
          </div>
          {accion}
          <IconButton icon="x" aria-label="Cerrar" onClick={onCerrar} />
        </header>
        <div className={styles.cuerpo}>{children}</div>
      </div>
    </div>
  )
}
