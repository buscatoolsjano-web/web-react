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
 * El envoltorio de la ficha rápida: un cajón **superpuesto** al listado.
 *
 * Fase 19 · E7. Lo importante no es que esté a la derecha: es que no le quita
 * ancho a la tabla. Antes era una columna, y abrir la ficha reacomodaba el
 * listado entero —columnas recalculadas, emails recortados, la fila que se
 * estaba mirando corrida de lugar—. Un panel que existe para no perder el
 * contexto no puede destruirlo al abrirse.
 *
 * Dos formas, y la diferencia no es cosmética:
 *
 * - **desde 1024 px** es un cajón que se apoya sobre el listado y lo deja ver.
 *   NO es un modal: se puede seguir filtrando y clickear otra fila sin cerrar
 *   nada, así que no atrapa el foco ni deja el resto `inert` —hacer eso en un
 *   panel no modal es un error de accesibilidad, no una precaución.
 * - **abajo de 1024 px** tapa el listado, y ahí sí es modal: el foco queda
 *   adentro y el fondo, inerte.
 *
 * En los dos casos Escape cierra y el foco vuelve a la fila.
 */
export function PanelLateralCliente({ clienteId, onCerrar }: PanelLateralClienteProps) {
  const esAncho = useMediaQuery('(min-width: 1024px)')
  return esAncho ? (
    <Cajon clienteId={clienteId} onCerrar={onCerrar} />
  ) : (
    <HojaCompleta clienteId={clienteId} onCerrar={onCerrar} />
  )
}

function Cajon({ clienteId, onCerrar }: PanelLateralClienteProps) {
  const idTitulo = useId()
  const caja = useRef<HTMLElement>(null)
  const cerrar = useRef(onCerrar)
  useEffect(() => {
    cerrar.current = onCerrar
  })

  /**
   * Escape cierra desde cualquier lado.
   *
   * También con el foco en la lista: el panel está tapando parte de la
   * pantalla, y quien lo quiere sacar no tiene por qué haber entrado en él
   * primero. Es la tecla de «sacame esto de encima».
   */
  useEffect(() => {
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
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
      data-panel-cliente
    >
      <div className={styles.barra}>
        <span className={styles.titulo}>Ficha rápida</span>
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
        data-panel-cliente
      >
        <div className={styles.barra}>
          <span className={styles.titulo}>Ficha rápida</span>
          <IconButton icon="x" aria-label="Cerrar la ficha rápida" onClick={onCerrar} />
        </div>
        <div className={styles.cuerpo}>
          <FichaRapidaCliente clienteId={clienteId} tituloId={idTitulo} />
        </div>
      </div>
    </div>
  )
}
