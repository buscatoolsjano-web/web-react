import { etiquetaDeEstadoPedido, etiquetaDeRecepcion } from '../lib/estados'
import styles from './ChipEstado.module.css'

export interface ChipEstadoProps {
  estado: string
}

/** El estado comercial: lo decide una persona. */
export function ChipEstado({ estado }: ChipEstadoProps) {
  const clase =
    estado === 'confirmed' ? styles.confirmado
    : estado === 'cancelled' ? styles.cancelado
    : styles.borrador
  return <span className={clase}>{etiquetaDeEstadoPedido(estado)}</span>
}

/**
 * El estado logístico: lo deriva la base mirando todas las líneas.
 *
 * Va en un chip aparte y con otro color a propósito. En el legacy había un
 * solo estado y no se distinguía «lo confirmé» de «me llegó».
 */
export function ChipRecepcion({ estado }: ChipEstadoProps) {
  const clase =
    estado === 'received' ? styles.recibido
    : estado === 'partially_received' ? styles.parcial
    : styles.pendiente
  return <span className={clase}>{etiquetaDeRecepcion(estado)}</span>
}

/**
 * El estado de la recepción: `draft` o `confirmed`, los dos del CHECK.
 *
 * No hay más, y no se agregan por simetría con otros documentos. Una
 * recepción confirmada movió stock y no vuelve atrás: revertirla sería un
 * contramovimiento explícito, y eso no está en v1.
 */
export function ChipRecepcionDoc({ estado }: ChipEstadoProps) {
  return estado === 'confirmed' ? (
    <span className={styles.recibido}>Confirmada</span>
  ) : (
    <span className={styles.borrador}>Borrador</span>
  )
}
