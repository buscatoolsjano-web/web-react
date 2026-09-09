import type { EstadoPresentable } from '../lib/estados'
import styles from './ChipEstado.module.css'

export function ChipEstado({ estado }: { estado: EstadoPresentable }) {
  return <span className={`${styles.chip} ${styles[estado.tono]}`}>{estado.etiqueta}</span>
}
