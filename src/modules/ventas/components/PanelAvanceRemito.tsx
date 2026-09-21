import { formatearCantidad } from '../lib/formato'
import type { AvanceDelRemito } from '../services/relacionados'
import styles from './PanelPendientes.module.css'

export interface PanelAvanceRemitoProps {
  avance: AvanceDelRemito | undefined
  cargando: boolean
  /** `true` si el remito ya salió: entonces «esta entrega» ya es entregado. */
  despachado: boolean
}

/**
 * Los cuatro números de un remito contra su pedido (Fase 19 · E5).
 *
 *   Pedido · Ya entregado · Esta entrega · Pendiente después
 *
 * «Ya entregado» cuenta **otros** remitos ya despachados. «Esta entrega» es lo
 * que lleva éste, que mientras está en borrador **todavía no salió**: no movió
 * una unidad de stock. Por eso las dos columnas están separadas.
 *
 * Y la regla de siempre: si alguna línea de entrega no está enlazada a una
 * línea del pedido —147 de las 631 migradas—, el reparto por línea no es
 * confiable y no se muestra ningún número. NO CONSTA ≠ NO ENTREGADO.
 */
export function PanelAvanceRemito({ avance, cargando, despachado }: PanelAvanceRemitoProps) {
  if (cargando || !avance) {
    return <p className={styles.nota}>Calculando el avance del pedido…</p>
  }

  if (avance.sinEnlazar > 0 || avance.repartoDudoso) {
    return (
      <div className={styles.aviso} role="note">
        <p className={styles.avisoTitulo}>Avance no reconstruido</p>
        <p className={styles.avisoTexto}>
          {avance.sinEnlazar > 0
            ? `${avance.sinEnlazar} ${avance.sinEnlazar === 1 ? 'línea de este remito no está enlazada' : 'líneas de este remito no están enlazadas'} a una línea del pedido: el sistema anterior sólo guardaba la relación a nivel de documento.`
            : 'Otro remito del mismo pedido tiene líneas que no se pudieron enlazar, así que el reparto por línea deja de ser confiable para todo el pedido.'}{' '}
          <strong>No se calcula el avance por línea.</strong>
        </p>
      </div>
    )
  }

  if (avance.lineas.length === 0) return null

  return (
    <>
      <div className={styles.scroll}>
        <table className={styles.tabla}>
          <thead>
            <tr>
              <th scope="col">Referencia</th>
              <th scope="col" className={styles.derecha}>
                Pedido
              </th>
              <th scope="col" className={styles.derecha}>
                Ya entregado
              </th>
              <th scope="col" className={styles.derecha}>
                Esta entrega
              </th>
              <th scope="col" className={styles.derecha}>
                {despachado ? 'Pendiente' : 'Pendiente después'}
              </th>
            </tr>
          </thead>
          <tbody>
            {avance.lineas.map((l) => (
              <tr key={l.lineaPedidoId}>
                <td>
                  <span className={styles.sku}>{l.sku ?? '—'}</span>
                  <span className={styles.nombre}>{l.nombre ?? ''}</span>
                </td>
                <td className={styles.derecha} data-etiqueta="Pedido">
                  {formatearCantidad(l.pedido)}
                </td>
                <td className={styles.derecha} data-etiqueta="Ya entregado">
                  {formatearCantidad(l.yaEntregado)}
                </td>
                <td className={styles.derecha} data-etiqueta="Esta entrega">
                  {formatearCantidad(l.estaEntrega)}
                </td>
                <td className={styles.derecha} data-etiqueta="Pendiente">
                  {formatearCantidad(l.pendienteDespues)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!despachado ? (
        <p className={styles.nota}>
          Este remito <strong>todavía no salió</strong>: «esta entrega» no movió stock y el pedido la
          sigue contando como pendiente hasta confirmarlo y despacharlo.
        </p>
      ) : null}
    </>
  )
}
