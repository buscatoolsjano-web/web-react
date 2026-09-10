import { formatearImporte } from '../lib/formato'
import type { TotalesPrevios } from '../lib/lineas'
import styles from './PanelTotales.module.css'

export interface PanelTotalesProps {
  moneda: string
  /** Lo que devolvió el servidor. Es el que vale. */
  servidor: { subtotal: number; impuesto: number; total: number } | null
  /** La cuenta local, para mostrar mientras se edita sin guardar. */
  previo: TotalesPrevios
  /** `true` mientras hay cambios sin guardar. */
  sinGuardar: boolean
}

/**
 * Los totales del pedido.
 *
 * **El total que vale es el del servidor.** Lo calcula
 * `app.totales_pedido_compra()` y lo escribe un trigger desde las líneas; la
 * aplicación no lo manda nunca, y si lo mandara el trigger lo pisaría igual.
 *
 * Mientras hay cambios sin guardar se muestra la cuenta local con un aviso,
 * porque si no la pantalla mostraría el total viejo mientras se escribe. En
 * cuanto se guarda vuelve el del servidor. Si las dos cuentas difieren, la
 * que está mal es la local.
 *
 * El descuento sale de restar: es cuánto se ahorró por los descuentos de
 * línea. No hay una columna de descuento en la cabecera y no se inventa una.
 */
export function PanelTotales({ moneda, servidor, previo, sinGuardar }: PanelTotalesProps) {
  const mostrarPrevio = sinGuardar || servidor === null
  const subtotal = mostrarPrevio ? previo.subtotal : servidor.subtotal
  const impuesto = mostrarPrevio ? previo.impuesto : servidor.impuesto
  const total = mostrarPrevio ? previo.total : servidor.total

  return (
    <div className={styles.panel}>
      <dl className={styles.lista}>
        {previo.descuento > 0 ? (
          <>
            <div className={styles.fila}>
              <dt>Bruto</dt>
              <dd>{formatearImporte(previo.bruto, moneda)}</dd>
            </div>
            <div className={styles.fila}>
              <dt>Descuento de líneas</dt>
              <dd className={styles.descuento}>
                − {formatearImporte(previo.descuento, moneda)}
              </dd>
            </div>
          </>
        ) : null}
        <div className={styles.fila}>
          <dt>Subtotal</dt>
          <dd>{formatearImporte(subtotal, moneda)}</dd>
        </div>
        <div className={styles.fila}>
          <dt>Impuesto</dt>
          <dd>{formatearImporte(impuesto, moneda)}</dd>
        </div>
        <div className={styles.total}>
          <dt>Total</dt>
          <dd>{formatearImporte(total, moneda)}</dd>
        </div>
      </dl>

      <p className={styles.nota}>
        {mostrarPrevio
          ? 'Cuenta provisoria. El total definitivo lo calcula el servidor al guardar.'
          : 'Calculado por el servidor desde las líneas.'}
      </p>
    </div>
  )
}
