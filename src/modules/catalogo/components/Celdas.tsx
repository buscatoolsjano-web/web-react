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

/**
 * El stock, dicho con todas las letras (Fase 86).
 *
 * ── POR QUÉ NO ALCANZABA CON «37 / 37» ──────────────────────────────────────
 *
 * En el listado los números van debajo de dos encabezados que dicen «Stock
 * real» y «Stock virtual», así que la barra no necesita repetirlo. En la ficha
 * del producto y en el comparador no hay encabezado: ahí quedaba «Real 37 ·
 * Virtual 37» en el cuerpo más chico y más apagado de la tarjeta, al lado de
 * un precio enorme. Dicho por quien lo usa: «quiero que sea más claro donde
 * marca el stock».
 *
 * ── QUÉ SE DICE ─────────────────────────────────────────────────────────────
 *
 * Lo primero es lo único que decide: SI SE PUEDE ENTREGAR HOY y cuánto. Eso es
 * el virtual —lo que hay menos lo comprometido—, y va como estado con color y
 * punto, no como número suelto.
 *
 * Lo reservado va atrás y sólo cuando existe. «37 disponibles» a secas y «37
 * disponibles, 7 reservados» son dos situaciones distintas, pero la segunda
 * sólo importa si alguien pregunta de dónde sale la diferencia; ponerla
 * siempre —con un «0 reservados»— es ruido en el noventa por ciento de los
 * productos.
 *
 * El punto del badge no es decorativo: es lo que hace que el estado se
 * distinga sin depender del color, para quien no lo ve.
 */
export function StockDestacado({ stock }: { stock: StockProducto | null }) {
  /* Sin fila en `stock_balances` no es cero: es que nunca se midió. Misma
     regla que `StockCelda`, y por eso el texto es el mismo. */
  if (!stock) {
    return (
      <Badge tone="neutral" outline>
        Sin movimientos
      </Badge>
    )
  }

  const reservado = stock.real - stock.virtual

  if (stock.virtual <= 0) {
    return (
      <span className={styles.stockDestacado}>
        <Badge tone="danger" dot>
          Sin stock
        </Badge>
        {/* Todo comprometido no es lo mismo que no tener nada, y es la
            diferencia entre «no lo pidas» y «esperá a que se libere». */}
        {reservado > 0 ? (
          <span className={styles.stockDetalle}>
            {formatearCantidad(stock.real)} en depósito, todo reservado
          </span>
        ) : null}
      </span>
    )
  }

  return (
    <span className={styles.stockDestacado}>
      <Badge tone="success" dot>
        {formatearCantidad(stock.virtual)} disponibles
      </Badge>
      {reservado > 0 ? (
        <span className={styles.stockDetalle}>
          {formatearCantidad(reservado)} reservados de {formatearCantidad(stock.real)}
        </span>
      ) : null}
    </span>
  )
}
