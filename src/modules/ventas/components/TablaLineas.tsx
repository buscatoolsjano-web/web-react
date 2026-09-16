import { Icon } from '@/components/icons/Icon'
import { formatearCantidad, formatearImporte } from '../lib/formato'
import { TRATAMIENTOS } from '../lib/tratamientos'
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

/**
 * Cómo se muestra el impuesto de la línea.
 *
 * Se prefiere la etiqueta del tratamiento («IVA 21 %») y no la alícuota suelta:
 * «Exento» y «No gravado» son los dos 0 % y no significan lo mismo.
 */
function impuesto(l: LineaDocumento): string {
  const t = TRATAMIENTOS.find((x) => x.valor === l.tratamientoImpuesto)
  if (t && t.tasa !== null) return t.etiqueta
  if (l.tasaImpuesto !== null) return `${formatearCantidad(l.tasaImpuesto)} %`
  return t?.etiqueta ?? '—'
}

export function TablaLineas({ lineas, moneda, tipo }: TablaLineasProps) {
  if (lineas.length === 0) {
    return <p className={styles.vacio}>Este documento no tiene líneas.</p>
  }

  // Las 600 líneas de entrega históricas no tienen precio: el legacy sólo
  // guardó el importe en la cabecera. En ese caso las columnas de precio no
  // se muestran vacías, se ocultan y se explica por qué.
  const hayPrecios = lineas.some((l) => l.precioUnitario !== null)
  const columnas = hayPrecios ? 8 : 4

  return (
    <>
      <div className={styles.scroll}>
        <table className={styles.tabla}>
          <caption className="sr-only">Líneas del documento</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.num}>
                #
              </th>
              <th scope="col">Referencia</th>
              <th scope="col">Producto</th>
              <th scope="col" className={styles.colDescripcion}>
                Descripción
              </th>
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
                    Impuesto
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
                  <td colSpan={columnas + 1}>{l.nombre ?? l.descripcion ?? '—'}</td>
                </tr>
              ) : (
                <tr key={l.id}>
                  <td className={styles.num} data-label="#">
                    {l.numeroLinea ?? '—'}
                  </td>
                  <td className={styles.sku} data-label="Referencia">
                    {l.sku ?? '—'}
                    {l.sku && l.productId === null ? (
                      <span
                        className={styles.sinProducto}
                        title="El SKU quedó guardado, pero el producto no está en el catálogo actual"
                      >
                        <Icon name="alert-triangle" size={16} />
                        <span className="sr-only">Producto fuera del catálogo actual</span>
                      </span>
                    ) : null}
                  </td>
                  <td className={styles.celdaNombre} data-label="Producto">
                    <span className={styles.nombre}>{l.nombre ?? '—'}</span>
                    {/* La descripción tiene columna propia a partir de 1280px.
                        Más angosto no entra, así que vuelve acá debajo del
                        nombre: sólo una de las dos copias se ve nunca. */}
                    {l.descripcion && l.descripcion !== l.nombre ? (
                      <span className={styles.descripcionInline} aria-hidden="true">
                        {l.descripcion}
                      </span>
                    ) : null}
                  </td>
                  <td className={styles.colDescripcion} data-label="Descripción">
                    {l.descripcion && l.descripcion !== l.nombre ? (
                      <span className={styles.descripcion}>{l.descripcion}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={`${styles.derecha} ${styles.cantidad}`} data-label="Cant.">
                    {formatearCantidad(l.cantidad)}
                  </td>
                  {hayPrecios ? (
                    <>
                      <td className={`${styles.derecha} ${styles.precio}`} data-label="Precio">
                        {formatearImporte(l.precioUnitario, moneda)}
                      </td>
                      <td className={`${styles.derecha} ${styles.dto}`} data-label="% Dto.">
                        {l.descuentoPct === null || l.descuentoPct === 0
                          ? '—'
                          : `${formatearCantidad(l.descuentoPct)} %`}
                      </td>
                      <td className={`${styles.derecha} ${styles.impuestoCelda}`} data-label="Impuesto">
                        {impuesto(l)}
                      </td>
                      <td className={`${styles.derecha} ${styles.subtotal}`} data-label="Subtotal">
                        {formatearImporte(subtotal(l), moneda)}
                      </td>
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
