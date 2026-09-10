import type { ComprasDelProveedor } from '../types'
import styles from './PanelCompras.module.css'

export interface PanelComprasProps {
  datos: ComprasDelProveedor | undefined
  cargando: boolean
}

/**
 * Compras relacionadas.
 *
 * Los tres números salen de contar contra `purchase_orders`, `goods_receipts`
 * y `supplier_invoices`, que existen desde la entrega 1. Hoy dan cero en los
 * tres y eso es un dato verdadero, no un placeholder: el circuito todavía no
 * tiene pantalla, así que no hay ningún documento cargado.
 *
 * Cuando los haya, esta pestaña los cuenta sola. Lo que falta es la pantalla
 * para verlos, y eso es la entrega 3.
 */
export function PanelCompras({ datos, cargando }: PanelComprasProps) {
  if (cargando) return <p className={styles.nota}>Cargando…</p>

  const total = (datos?.pedidos ?? 0) + (datos?.recepciones ?? 0) + (datos?.facturas ?? 0)

  return (
    <div className={styles.panel}>
      <dl className={styles.numeros}>
        <div className={styles.numero}>
          <dt className={styles.etiqueta}>Pedidos de compra</dt>
          <dd className={styles.valor}>{datos?.pedidos ?? 0}</dd>
        </div>
        <div className={styles.numero}>
          <dt className={styles.etiqueta}>Notas de entrega</dt>
          <dd className={styles.valor}>{datos?.recepciones ?? 0}</dd>
        </div>
        <div className={styles.numero}>
          <dt className={styles.etiqueta}>Facturas de proveedor</dt>
          <dd className={styles.valor}>{datos?.facturas ?? 0}</dd>
        </div>
      </dl>

      {total === 0 ? (
        <p className={styles.nota}>
          Este proveedor todavía no tiene documentos de compra. El circuito —pedido, recepción
          y factura— existe en la base desde la entrega anterior, pero la pantalla para
          cargarlos no está hecha: no hay ninguno todavía, en ningún proveedor.
        </p>
      ) : null}
    </div>
  )
}
