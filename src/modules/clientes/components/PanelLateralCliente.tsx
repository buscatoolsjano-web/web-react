import { useEffect, useId, useRef } from 'react'
import { IconButton } from '@/components/ui/IconButton'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useModalAccesible } from '@/components/modals/useModalAccesible'
import { FichaRapidaCliente } from './FichaRapidaCliente'
import styles from './PanelLateralCliente.module.css'

export interface PanelLateralClienteProps {
  clienteId: string
  onCerrar: () => void
}

/**
 * El envoltorio de la ficha rápida. Dos formas, una por tamaño de pantalla, y
 * la diferencia entre las dos no es cosmética:
 *
 * - **desde 1280 px** es un panel al costado que convive con el listado. NO es
 *   un modal: la lista se sigue viendo, se puede seguir filtrando y se puede
 *   clickear otra fila sin cerrar nada. Por eso no atrapa el foco ni deja el
 *   resto de la página `inert` — hacerlo en un panel no modal es un error de
 *   accesibilidad, no una precaución.
 * - **abajo de 1280 px** es una hoja a pantalla completa, y ahí sí es modal:
 *   tapa la lista, así que el foco tiene que quedar adentro y el fondo tiene
 *   que estar inerte.
 *
 * En los dos casos Escape cierra y el foco vuelve a donde estaba.
 */
export function PanelLateralCliente({ clienteId, onCerrar }: PanelLateralClienteProps) {
  const esAncho = useMediaQuery('(min-width: 1280px)')
  return esAncho ? (
    <PanelDeCostado clienteId={clienteId} onCerrar={onCerrar} />
  ) : (
    <HojaCompleta clienteId={clienteId} onCerrar={onCerrar} />
  )
}

function PanelDeCostado({ clienteId, onCerrar }: PanelLateralClienteProps) {
  const idTitulo = useId()
  const caja = useRef<HTMLElement>(null)
  const cerrar = useRef(onCerrar)
  useEffect(() => {
    cerrar.current = onCerrar
  })

  // Escape cierra, pero sólo si el foco está dentro del panel: si está en la
  // lista, Escape es de la lista (por ejemplo, para limpiar una búsqueda).
  useEffect(() => {
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (!caja.current?.contains(document.activeElement)) return
      e.preventDefault()
      cerrar.current()
    }
    document.addEventListener('keydown', alTeclado)
    return () => document.removeEventListener('keydown', alTeclado)
  }, [])

  /**
   * El foco entra al abrir y vuelve a la fila al cerrar.
   *
   * Sin dependencias a propósito: corre al ABRIR el panel, no cada vez que se
   * cambia de cliente. Robarle el foco a alguien que está recorriendo la lista
   * con el teclado, en cada flecha, sería insoportable.
   */
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
      // `complementary` y no `dialog`: acompaña al listado, no lo interrumpe.
      role="complementary"
      tabIndex={-1}
    >
      <div className={styles.barra}>
        <IconButton icon="x" aria-label="Cerrar la ficha rápida" onClick={onCerrar} />
      </div>
      <div className={styles.cuerpo}>
        <FichaRapidaCliente clienteId={clienteId} tituloId={idTitulo} />
      </div>
    </aside>
  )
}

function HojaCompleta({ clienteId, onCerrar }: PanelLateralClienteProps) {
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
      >
        <div className={styles.barra}>
          <IconButton icon="x" aria-label="Cerrar la ficha rápida" onClick={onCerrar} />
        </div>
        <div className={styles.cuerpo}>
          <FichaRapidaCliente clienteId={clienteId} tituloId={idTitulo} />
        </div>
      </div>
    </div>
  )
}
