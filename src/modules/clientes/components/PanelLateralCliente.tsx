import { useId, useRef } from 'react'
import { IconButton } from '@/components/ui/IconButton'
import { useModalAccesible } from '@/components/modals/useModalAccesible'
import { FichaRapidaCliente } from './FichaRapidaCliente'
import styles from './PanelLateralCliente.module.css'

export interface PanelLateralClienteProps {
  clienteId: string
  onCerrar: () => void
}

/**
 * La ficha rápida del cliente, encima de lo que se estaba mirando.
 *
 * Se abre desde el listado de Clientes y desde cualquier documento de Ventas:
 * es la misma ficha y el mismo componente, así que abrirla desde un contexto
 * no puede destruirlo.
 *
 * **Es modal, en todos los anchos** (Fase 27 · E4). Hasta acá, con 1024 px o
 * más, era un cajón que se apoyaba sobre el listado y lo dejaba usar: se podía
 * seguir filtrando y abrir otra fila sin cerrar nada. Se pidió lo contrario, y
 * con razón práctica: quedaba media pantalla de lista viva detrás de la ficha,
 * el scroll del fondo se movía debajo del panel y no era obvio que había algo
 * abierto. Ahora el fondo se oscurece, no se desplaza, no se puede tocar, y un
 * click afuera cierra.
 *
 * Escape cierra y el foco vuelve a la fila que la abrió, como antes.
 */
export function PanelLateralCliente({ clienteId, onCerrar }: PanelLateralClienteProps) {
  const idTitulo = useId()
  const caja = useRef<HTMLDivElement>(null)
  useModalAccesible(caja, { onClose: onCerrar })

  return (
    <div
      className={styles.fondo}
      /* Un click en el fondo cierra; uno adentro de la hoja no. Se compara el
         target con el propio fondo en vez de usar un `stopPropagation` en la
         hoja: así un control de adentro que cierre su propio popover no queda
         cerrando también la ficha. */
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar()
      }}
    >
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
