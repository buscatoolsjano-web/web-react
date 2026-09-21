import { useEffect, useId, useRef } from 'react'
import { IconButton } from '@/components/ui/IconButton'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useModalAccesible } from '@/components/modals/useModalAccesible'
import { FichaRapidaActivo } from './FichaRapidaActivo'
import styles from './PanelLateralActivo.module.css'

export interface PanelLateralActivoProps {
  activoId: string
  onCerrar: () => void
}

/**
 * El cajón de la ficha rápida del equipo.
 *
 * Es el mismo patrón que Clientes (Fase 19 · E7) y por la misma razón: el
 * panel **se superpone** al listado y no le saca ancho. En el taller se miran
 * cinco equipos seguidos, y que la tabla se reacomode en cada uno hace perder
 * la fila que se venía siguiendo.
 *
 * Desde 1024 px no es modal —se puede seguir filtrando y abrir otra fila—; por
 * debajo tapa la lista y entonces sí atrapa el foco. Escape cierra en los dos
 * casos y el foco vuelve a la fila.
 */
export function PanelLateralActivo({ activoId, onCerrar }: PanelLateralActivoProps) {
  const esAncho = useMediaQuery('(min-width: 1024px)')
  return esAncho ? (
    <Cajon activoId={activoId} onCerrar={onCerrar} />
  ) : (
    <HojaCompleta activoId={activoId} onCerrar={onCerrar} />
  )
}

function Cajon({ activoId, onCerrar }: PanelLateralActivoProps) {
  const idTitulo = useId()
  const caja = useRef<HTMLElement>(null)
  const cerrar = useRef(onCerrar)
  useEffect(() => {
    cerrar.current = onCerrar
  })

  useEffect(() => {
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      cerrar.current()
    }
    document.addEventListener('keydown', alTeclado)
    return () => document.removeEventListener('keydown', alTeclado)
  }, [])

  // Sin dependencias: corre al ABRIR, no al cambiar de equipo. Robarle el foco
  // a alguien que recorre la lista con el teclado sería insoportable.
  useEffect(() => {
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    caja.current?.focus()
    return () => {
      if (previo?.isConnected) previo.focus()
    }
  }, [])

  return (
    <aside
      ref={caja}
      className={styles.panel}
      aria-labelledby={idTitulo}
      role="complementary"
      tabIndex={-1}
      data-panel-activo
    >
      <div className={styles.barra}>
        <span className={styles.titulo}>Ficha rápida</span>
        <IconButton icon="x" aria-label="Cerrar la ficha rápida" onClick={onCerrar} />
      </div>
      <div className={styles.cuerpo}>
        <FichaRapidaActivo activoId={activoId} tituloId={idTitulo} />
      </div>
    </aside>
  )
}

function HojaCompleta({ activoId, onCerrar }: PanelLateralActivoProps) {
  const idTitulo = useId()
  const caja = useRef<HTMLDivElement>(null)
  useModalAccesible(caja, { onClose: onCerrar })

  return (
    <div className={styles.fondo}>
      <div
        ref={caja}
        className={styles.hoja}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        data-panel-activo
      >
        <div className={styles.barra}>
          <span className={styles.titulo}>Ficha rápida</span>
          <IconButton icon="x" aria-label="Cerrar la ficha rápida" onClick={onCerrar} />
        </div>
        <div className={styles.cuerpo}>
          <FichaRapidaActivo activoId={activoId} tituloId={idTitulo} />
        </div>
      </div>
    </div>
  )
}
