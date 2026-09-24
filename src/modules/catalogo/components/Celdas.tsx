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
  /*
   * Sin saldo registrado NO es cero (Fase 21 · E3.1).
   *
   * Un producto sin fila en `stock_balances` nunca tuvo movimientos: no
   * sabemos cuánto hay, y escribir «0» afirma que no hay ninguno. Son 21.449
   * productos de 21.828, así que el error no era de borde: era casi todo el
   * catálogo diciendo un número que nadie midió.
   */
  if (!stock) {
    return (
      <span className={`${styles.stock} ${styles.sinDato}`} title="Este producto nunca tuvo movimientos de stock">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Sin saldo registrado</span>
      </span>
    )
  }
  return (
    <span className={styles.stock}>
      <strong>{formatearCantidad(stock.real)}</strong>
      <span className="sr-only"> real</span>
      <span className={styles.stockVirtual}>
        <span aria-hidden="true">/ </span>
        {formatearCantidad(stock.virtual)}
        <span className="sr-only"> virtual</span>
      </span>
    </span>
  )
}

/**
 * Un solo saldo, para la tabla de dos columnas (Fase 25 · E2).
 *
 * El listado pasó a tener «Stock real» y «Stock virtual» separadas —como el
 * legacy (`app.js:15518`)— porque cada una se ordena por su cuenta. `—` sigue
 * significando «sin saldo registrado», no cero, por la misma razón de siempre.
 *
 * El negativo se marca: un saldo real bajo cero es un error de carga, y en
 * una columna de números pasa desapercibido.
 */
export function SaldoCelda({ valor }: { valor: number | null }) {
  if (valor === null) {
    return (
      <span className={styles.sinDato} title="Este producto nunca tuvo movimientos de stock">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Sin saldo registrado</span>
      </span>
    )
  }
  return <span className={valor < 0 ? styles.negativo : undefined}>{formatearCantidad(valor)}</span>
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
