import { TITULO_BANNER_STEL } from '../lib/autoridad'
import styles from './AvisoAutoridadStel.module.css'

export interface AvisoAutoridadStelProps {
  /** Qué sigue funcionando en esta pantalla. */
  detalle: string
}

/** Banner de convivencia con STEL: la emisión desde el ERP está bloqueada. */
export function AvisoAutoridadStel({ detalle }: AvisoAutoridadStelProps) {
  return (
    <div className={styles.caja} role="note" data-testid="aviso-autoridad-stel">
      <p className={styles.titulo}>{TITULO_BANNER_STEL}</p>
      <p className={styles.detalle}>{detalle}</p>
    </div>
  )
}
