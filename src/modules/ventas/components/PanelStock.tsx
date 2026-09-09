import { formatearCantidad } from '../lib/formato'
import { faltante, type DisponibilidadProducto } from '../services/stock'
import type { LineaDocumento } from '../types'
import styles from './PanelStock.module.css'

export interface PanelStockProps {
  lineas: readonly LineaDocumento[]
  disponibilidad: Map<string, DisponibilidadProducto> | undefined
  cargando: boolean
  esInterno: boolean
}

/**
 * Disponibilidad de lo que pide el pedido.
 *
 * **Es sólo lectura.** Crear un pedido no reserva ni descuenta nada: la
 * reserva es una acción explícita del diseño y todavía no está implementada.
 * El legacy descontaba stock al generar la nota de entrega y avisaba
 * «SR descontado»; eso llega en la entrega 5.
 */
export function PanelStock({ lineas, disponibilidad, cargando, esInterno }: PanelStockProps) {
  if (!esInterno) return null

  const visibles = lineas.filter((l) => l.tipoLinea !== 'chapter' && l.productId !== null)

  if (visibles.length === 0) {
    return (
      <p className={styles.nota}>
        Ninguna línea está asociada a un producto del catálogo, así que no hay stock que mirar.
      </p>
    )
  }

  if (cargando || !disponibilidad) return <p className={styles.nota}>Consultando stock…</p>

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
                En stock
              </th>
              <th scope="col" className={styles.derecha}>
                Reservado
              </th>
              <th scope="col" className={styles.derecha}>
                Libre
              </th>
              <th scope="col" className={styles.derecha}>
                Faltante
              </th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((l) => {
              const d = disponibilidad.get(l.productId!)
              const falta = faltante(l.cantidad, d)
              return (
                <tr key={l.id}>
                  <td>
                    <span className={styles.sku}>{l.sku ?? '—'}</span>
                    <span className={styles.nombre}>{l.nombre ?? ''}</span>
                  </td>
                  <td className={styles.derecha}>{formatearCantidad(l.cantidad)}</td>
                  {d ? (
                    <>
                      <td className={styles.derecha}>{formatearCantidad(d.enStock)}</td>
                      <td className={styles.derecha}>{formatearCantidad(d.reservado)}</td>
                      <td className={styles.derecha}>{formatearCantidad(d.libre)}</td>
                      <td className={styles.derecha}>
                        {falta > 0 ? (
                          <span className={styles.falta}>{formatearCantidad(falta)}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </>
                  ) : (
                    // Sin fila en stock_balances no se sabe si hay 0 o si nunca
                    // se movió: no es lo mismo, así que no se inventa un cero.
                    <td colSpan={4} className={styles.sinDato}>
                      Sin movimientos de stock registrados
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.nota}>
        Es sólo informativo: <strong>crear o editar un pedido no reserva ni descuenta stock</strong>.
      </p>
    </>
  )
}
