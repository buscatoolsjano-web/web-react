import { formatearCantidad, formatearImporte } from '../lib/formato'
import type { LineaDocumento, TipoDocumento } from '../types'
import styles from './TablaLineas.module.css'

export interface TablaLineasProps {
  lineas: readonly LineaDocumento[]
  moneda: string | null
  tipo: TipoDocumento
}

/** Subtotal de una línea, sólo si hay precio. Sin precio no se inventa un 0. */
function subtotal(l: LineaDocumento): number | null {
  if (l.precioUnitario === null) return null
  const bruto = l.precioUnitario * l.cantidad
  const dto = l.descuentoPct ?? 0
  return bruto * (1 - dto / 100)
}

export function TablaLineas({ lineas, moneda, tipo }: TablaLineasProps) {
  if (lineas.length === 0) {
    return <p className={styles.vacio}>Este documento no tiene líneas.</p>
  }

  // Las 600 líneas de entrega históricas no tienen precio: el legacy sólo
  // guardó el importe en la cabecera. En ese caso las columnas de precio no
  // se muestran vacías, se ocultan y se explica por qué.
  const hayPrecios = lineas.some((l) => l.precioUnitario !== null)

  return (
    <>
      <div className={styles.scroll}>
        <table className={styles.tabla}>
          <thead>
            <tr>
              <th scope="col" className={styles.num}>
                #
              </th>
              <th scope="col">Referencia</th>
              <th scope="col">Descripción</th>
              <th scope="col" className={styles.derecha}>
                Cant.
              </th>
              {hayPrecios ? (
                <>
                  <th scope="col" className={styles.derecha}>
                    Precio
                  </th>
                  <th scope="col" className={styles.derecha}>
                    % Dto.
                  </th>
                  <th scope="col" className={styles.derecha}>
                    Subtotal
                  </th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) =>
              // Un capítulo es un título dentro del documento: ocupa toda la
              // fila y no lleva cantidad ni importe.
              l.tipoLinea === 'chapter' ? (
                <tr key={l.id} className={styles.capitulo}>
                  <td colSpan={hayPrecios ? 7 : 4}>{l.nombre ?? l.descripcion ?? '—'}</td>
                </tr>
              ) : (
                <tr key={l.id}>
                  <td className={styles.num}>{l.numeroLinea ?? '—'}</td>
                  <td className={styles.sku}>
                    {l.sku ?? '—'}
                    {l.sku && l.productId === null ? (
                      <span
                        className={styles.sinProducto}
                        title="El SKU quedó guardado, pero el producto no está en el catálogo actual"
                      >
                        {' '}
                        ⚠
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className={styles.nombre}>{l.nombre ?? '—'}</span>
                    {l.descripcion && l.descripcion !== l.nombre ? (
                      <span className={styles.descripcion}>{l.descripcion}</span>
                    ) : null}
                  </td>
                  <td className={styles.derecha}>{formatearCantidad(l.cantidad)}</td>
                  {hayPrecios ? (
                    <>
                      <td className={styles.derecha}>
                        {formatearImporte(l.precioUnitario, moneda)}
                      </td>
                      <td className={styles.derecha}>
                        {l.descuentoPct === null || l.descuentoPct === 0
                          ? '—'
                          : `${formatearCantidad(l.descuentoPct)} %`}
                      </td>
                      <td className={styles.derecha}>{formatearImporte(subtotal(l), moneda)}</td>
                    </>
                  ) : null}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {!hayPrecios && tipo === 'entrega' ? (
        <p className={styles.nota}>
          Esta entrega no tiene precios por línea: el sistema anterior sólo guardaba el importe en
          la cabecera del remito. <strong>No se reparte el total entre las líneas</strong> — sería
          inventar el dato.
        </p>
      ) : null}
    </>
  )
}
