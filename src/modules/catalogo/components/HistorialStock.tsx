import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { formatearFechaCorta, nombreDeMovimiento, saldosHaciaAtras } from '../lib/movimientos'
import type { MovimientoDeStock, StockProducto } from '../types'
import styles from './HistorialStock.module.css'

export interface HistorialStockProps {
  movimientos: readonly MovimientoDeStock[]
  total: number
  stockActual: StockProducto | null
  abierto: boolean
  cargando: boolean
  onAbrir: () => void
}

/**
 * Los últimos movimientos de stock del producto. **Sólo lectura.**
 *
 * Arranca plegado y se pide al abrirlo: si se cargara con el producto, mirar
 * diez productos serían diez historiales que nadie miró.
 *
 * El saldo de cada fila se **reconstruye hacia atrás** desde el saldo de hoy:
 * la tabla guarda el movimiento, no el saldo. La fila más nueva muestra el
 * saldo actual; la anterior, ese saldo menos lo que entró. Si no hay saldo
 * —un rol sin permiso no lo ve— la columna queda vacía en vez de inventarse.
 *
 * Entrada y salida se distinguen por **el signo y la palabra**, no sólo por
 * el color: el verde y el rojo son ayuda, no el dato.
 */
export function HistorialStock({
  movimientos,
  total,
  stockActual,
  abierto,
  cargando,
  onAbrir,
}: HistorialStockProps) {
  if (!abierto) {
    return (
      <div className={styles.plegado}>
        <Button variant="secondary" size="sm" onClick={onAbrir}>
          Ver historial de stock
        </Button>
        <span className={styles.nota}>Se consulta al abrirlo.</span>
      </div>
    )
  }

  if (cargando && movimientos.length === 0) {
    return <SkeletonRows rows={4} columns={4} label="Cargando el historial…" />
  }

  if (movimientos.length === 0) {
    return <p className={styles.vacio}>Sin movimientos registrados para este producto.</p>
  }

  const filas = saldosHaciaAtras(movimientos, stockActual?.real ?? null)

  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        <table className={styles.tabla}>
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Movimiento</th>
              <th scope="col" className={styles.num}>
                Cantidad
              </th>
              <th scope="col" className={styles.num}>
                Stock real
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map(({ m, resultante }) => (
              <tr key={m.id}>
                <td className={styles.fecha}>{formatearFechaCorta(m.fecha)}</td>
                <td>
                  <span className={styles.tipo}>{nombreDeMovimiento(m.tipo)}</span>
                  {m.notas ? <span className={styles.notas}>{m.notas}</span> : null}
                </td>
                <td className={`${styles.num} ${m.cantidad < 0 ? styles.salida : styles.entrada}`}>
                  {m.cantidad > 0 ? '+' : ''}
                  {m.cantidad}
                </td>
                <td className={styles.num}>
                  {resultante === null ? <span className={styles.sinDato}>—</span> : resultante}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.pie}>
        {movimientos.length === total
          ? `${total} ${total === 1 ? 'movimiento' : 'movimientos'} en total.`
          : `Últimos ${movimientos.length} de ${total} movimientos.`}
      </p>
    </div>
  )
}
