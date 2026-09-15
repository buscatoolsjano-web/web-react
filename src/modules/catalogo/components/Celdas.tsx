import { Badge } from '@/components/ui/Badge'
import { formatearCantidad, formatearPrecio, SIN_PRECIO } from '../lib/formato'
import type { StockProducto } from '../types'
import styles from './Celdas.module.css'

/**
 * Precio.
 *
 * El monto llega ya resuelto por la base: RLS eligió qué listas puede ver
 * el usuario y la consulta trajo la vigente. Acá no hay ninguna decisión de
 * negocio — en particular, NO existe nada parecido al `pu * 3` que el
 * legacy calculaba en JavaScript.
 */
export function PrecioCelda({ monto, moneda }: { monto: number | null; moneda: string | null }) {
  const texto = formatearPrecio(monto, moneda)
  const sinPrecio = texto === SIN_PRECIO
  return <span className={sinPrecio ? styles.sinDato : styles.precio}>{texto}</span>
}

/**
 * Stock para roles internos: real y virtual, como en el legacy.
 *
 * Real = on_hand · Virtual = on_hand − reserved. Visualmente «12 / 10»; el
 * lector de pantalla oye «12 real, 10 virtual».
 */
export function StockCelda({ stock }: { stock: StockProducto | null }) {
  const real = stock ? formatearCantidad(stock.real) : '0'
  const virtual = stock ? formatearCantidad(stock.virtual) : null
  return (
    <span className={stock ? styles.stock : `${styles.stock} ${styles.sinDato}`}>
      <strong>{real}</strong>
      <span className="sr-only"> real</span>
      {virtual !== null ? (
        <span className={styles.stockVirtual}>
          <span aria-hidden="true">/ </span>
          {virtual}
          <span className="sr-only"> virtual</span>
        </span>
      ) : null}
    </span>
  )
}

/**
 * Disponibilidad para roles externos: un booleano y nada más.
 *
 * `undefined` significa que todavía no llegó la respuesta; `false`, que no
 * hay stock. En ningún caso se muestra una cantidad.
 */
export function DisponibilidadBadge({ disponible }: { disponible: boolean | undefined }) {
  if (disponible === undefined) {
    return (
      <span className={styles.sinDato} aria-label="Consultando disponibilidad">
        …
      </span>
    )
  }
  return disponible ? <Badge tone="success">Disponible</Badge> : <Badge tone="neutral">Consultar</Badge>
}
