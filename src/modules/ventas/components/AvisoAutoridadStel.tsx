import { Alert } from '@/components/feedback/Alert'
import { TITULO_BANNER_STEL } from '../lib/autoridad'

export interface AvisoAutoridadStelProps {
  /** Qué sigue funcionando en esta pantalla. */
  detalle: string
  /**
   * El título, si el de siempre no aplica. Fase 19 · E3: un documento que el
   * ERP sí numera —serie `COT-ERP`— no puede anunciar que STEL numera «este
   * documento» sólo porque el pedido que saldría de él siga en STEL.
   */
  titulo?: string | undefined
  /**
   * Id del párrafo, para que los botones bloqueados lo referencien con
   * `aria-describedby` en vez de repetir el motivo debajo de la barra.
   */
  idDetalle?: string | undefined
}

/**
 * Banner de convivencia con STEL: la emisión desde el ERP está bloqueada.
 *
 * Fase 13: el mismo `Alert` de advertencia que el resto del sistema, con el
 * mismo título, texto y `data-testid` de E2.5. El rediseño no lo esconde.
 *
 * Fase 15 E1: es el ÚNICO mensaje de autoridad de la pantalla. Antes el mismo
 * hecho se contaba dos veces —acá y otra vez debajo de la barra de acciones—,
 * así que ahora los botones deshabilitados apuntan a este párrafo.
 */
export function AvisoAutoridadStel({ detalle, idDetalle, titulo }: AvisoAutoridadStelProps) {
  return (
    <Alert tone="warning" title={titulo ?? TITULO_BANNER_STEL} data-testid="aviso-autoridad-stel">
      <p id={idDetalle}>{detalle}</p>
    </Alert>
  )
}
