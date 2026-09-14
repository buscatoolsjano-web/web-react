import { Alert } from '@/components/feedback/Alert'
import { TITULO_BANNER_STEL } from '../lib/autoridad'

export interface AvisoAutoridadStelProps {
  /** Qué sigue funcionando en esta pantalla. */
  detalle: string
}

/**
 * Banner de convivencia con STEL: la emisión desde el ERP está bloqueada.
 *
 * Fase 13: el mismo `Alert` de advertencia que el resto del sistema, con el
 * mismo título, texto y `data-testid` de E2.5. El rediseño no lo esconde.
 */
export function AvisoAutoridadStel({ detalle }: AvisoAutoridadStelProps) {
  return (
    <Alert tone="warning" title={TITULO_BANNER_STEL} data-testid="aviso-autoridad-stel">
      <p>{detalle}</p>
    </Alert>
  )
}
