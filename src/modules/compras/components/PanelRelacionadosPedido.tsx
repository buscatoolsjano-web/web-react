import { Link } from 'react-router-dom'
import type { PedidoCompraDetalle, RelacionadosPedido } from '../types'
import styles from './PanelCompras.module.css'

export interface PanelRelacionadosPedidoProps {
  pedido: PedidoCompraDetalle
  datos: RelacionadosPedido | undefined
  cargando: boolean
}

/**
 * Lo que cuelga del pedido.
 *
 * El proveedor, con link a su ficha; las recepciones y las facturas de
 * proveedor, contadas contra las tablas reales. Hoy las dos últimas dan cero
 * porque el circuito no tiene pantalla todavía, y eso es lo que dice el
 * texto: no es un «próximamente», es que no hay ninguna.
 *
 * **No se muestra ninguna relación con Ventas.** Ese vínculo no existe en el
 * schema y reconstruirlo por fecha parecida, mismo SKU o cantidades parecidas
 * sería inventarlo.
 */
export function PanelRelacionadosPedido({
  pedido,
  datos,
  cargando,
}: PanelRelacionadosPedidoProps) {
  if (cargando) return <p className={styles.nota}>Cargando…</p>

  return (
    <div className={styles.panel}>
      <dl className={styles.numeros}>
        <div className={styles.numero}>
          <dt className={styles.etiqueta}>Proveedor</dt>
          <dd className={styles.valorTexto}>
            <Link className={styles.enlace} to={`/compras/proveedores/${pedido.proveedorId}`}>
              {pedido.proveedor}
            </Link>
            {pedido.proveedorReferencia ? (
              <span className={styles.ref}> · {pedido.proveedorReferencia}</span>
            ) : null}
          </dd>
        </div>
        <div className={styles.numero}>
          <dt className={styles.etiqueta}>Notas de entrada</dt>
          <dd className={styles.valor}>{datos?.recepciones ?? 0}</dd>
        </div>
        <div className={styles.numero}>
          <dt className={styles.etiqueta}>Facturas de proveedor</dt>
          <dd className={styles.valor}>{datos?.facturas ?? 0}</dd>
        </div>
      </dl>

      {(datos?.recepciones ?? 0) === 0 && (datos?.facturas ?? 0) === 0 ? (
        <p className={styles.nota}>
          Este pedido todavía no tiene recepciones ni facturas. Las dos tablas existen desde la
          entrega 1 y se cuentan de verdad; lo que falta son las pantallas para cargarlas.
        </p>
      ) : null}
    </div>
  )
}
