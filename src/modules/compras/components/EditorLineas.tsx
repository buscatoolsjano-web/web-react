import { TRATAMIENTOS } from '../lib/tratamientos'
import { netoDeLinea } from '../lib/lineas'
import { formatearImporte } from '../lib/formato'
import type { LineaPedidoCompra, UltimoPrecioCompra } from '../types'
import styles from './EditorLineas.module.css'

export type CampoLinea =
  | 'sku'
  | 'nombre'
  | 'cantidad'
  | 'precioUnitario'
  | 'descuentoPct'
  | 'tratamientoImpuesto'
  | 'tasaImpuesto'

export interface EditorLineasProps {
  lineas: readonly LineaPedidoCompra[]
  moneda: string
  /** `false` deja la tabla en sólo lectura sin cambiar el layout. */
  editable: boolean
  /** Último precio pagado por producto. Se muestra, nunca se autocompleta. */
  ultimosPrecios: ReadonlyMap<string, UltimoPrecioCompra>
  onCambiar: (lineaId: string, campo: CampoLinea, valor: string | number | null) => void
  onEliminar: (lineaId: string) => void
  onMover: (lineaId: string, direccion: -1 | 1) => void
}

function aNumero(v: string): number {
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/**
 * La tabla de líneas del pedido de compra.
 *
 * Cada línea tiene su propio `id` y su `line_no`: el orden es un dato, no la
 * posición en un array. En el legacy el índice ERA la identidad, y de ahí
 * salió el `entregado[idx]` que hubo que reconstruir en Stage 2.5.
 *
 * Cada campo se guarda al salir del control (`onBlur`) y sólo si cambió. El
 * neto que se ve mientras se escribe es una previsualización: el que vale es
 * el que devuelve el servidor.
 *
 * La columna **Precio** es el precio de COMPRA y se escribe a mano. Debajo,
 * cuando existe, aparece qué se pagó la última vez por ese producto en esta
 * misma moneda. Es un dato de un pedido confirmado, no una sugerencia
 * automática: nadie autocompleta nada.
 */
export function EditorLineas({
  lineas,
  moneda,
  editable,
  ultimosPrecios,
  onCambiar,
  onEliminar,
  onMover,
}: EditorLineasProps) {
  const commit = (
    l: LineaPedidoCompra,
    campo: CampoLinea,
    valorActual: string | number | null,
    valorNuevo: string | number | null,
  ) => {
    if (String(valorActual ?? '') === String(valorNuevo ?? '')) return
    onCambiar(l.id, campo, valorNuevo)
  }

  return (
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
            <th scope="col" className={styles.derecha}>
              Precio de compra
            </th>
            <th scope="col" className={styles.derecha}>
              % Dto.
            </th>
            <th scope="col">Impuesto</th>
            <th scope="col" className={styles.derecha}>
              Neto
            </th>
            {editable ? <th scope="col" aria-label="Acciones" /> : null}
          </tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => {
            const ultimo = l.productId ? ultimosPrecios.get(l.productId) : undefined
            return (
              <tr key={l.id} className={l.tipoLinea === 'chapter' ? styles.capitulo : undefined}>
                <td className={styles.num}>{l.numeroLinea}</td>

                {l.tipoLinea === 'chapter' ? (
                  <td colSpan={6}>
                    <input
                      className={styles.texto}
                      defaultValue={l.nombre ?? ''}
                      readOnly={!editable}
                      aria-label="Título del capítulo"
                      onBlur={(e) => commit(l, 'nombre', l.nombre, e.target.value)}
                    />
                  </td>
                ) : (
                  <>
                    <td>
                      <input
                        className={styles.sku}
                        defaultValue={l.sku ?? ''}
                        // El SKU de un producto del catálogo es su snapshot:
                        // no se edita, o dejaría de coincidir con el producto.
                        readOnly={!editable || l.productId !== null}
                        aria-label="Referencia"
                        onBlur={(e) => commit(l, 'sku', l.sku, e.target.value || null)}
                      />
                    </td>
                    <td>
                      <input
                        className={styles.texto}
                        defaultValue={l.nombre ?? ''}
                        readOnly={!editable}
                        aria-label="Descripción"
                        onBlur={(e) => commit(l, 'nombre', l.nombre, e.target.value || null)}
                      />
                      {l.productId === null ? (
                        <span className={styles.libre}>línea libre</span>
                      ) : null}
                    </td>
                    <td className={styles.derecha}>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        className={styles.numero}
                        defaultValue={l.cantidad}
                        readOnly={!editable}
                        aria-label="Cantidad"
                        onBlur={(e) => commit(l, 'cantidad', l.cantidad, aNumero(e.target.value))}
                      />
                    </td>
                    <td className={styles.derecha}>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        className={styles.numero}
                        defaultValue={l.precioUnitario ?? 0}
                        readOnly={!editable}
                        aria-label="Precio de compra"
                        onBlur={(e) =>
                          commit(l, 'precioUnitario', l.precioUnitario, aNumero(e.target.value))
                        }
                      />
                      {ultimo ? (
                        <span
                          className={styles.ultimo}
                          title={`${ultimo.numero} · ${ultimo.proveedor} · ${ultimo.fecha}`}
                        >
                          última compra {formatearImporte(ultimo.precio, moneda)}
                        </span>
                      ) : null}
                    </td>
                    <td className={styles.derecha}>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        max="100"
                        className={styles.numero}
                        defaultValue={l.descuentoPct}
                        readOnly={!editable}
                        aria-label="Descuento"
                        onBlur={(e) =>
                          commit(l, 'descuentoPct', l.descuentoPct, aNumero(e.target.value))
                        }
                      />
                    </td>
                    <td>
                      <select
                        className={styles.select}
                        value={l.tratamientoImpuesto}
                        disabled={!editable}
                        aria-label="Tratamiento de impuesto"
                        onChange={(e) => onCambiar(l.id, 'tratamientoImpuesto', e.target.value)}
                      >
                        {TRATAMIENTOS.map((t) => (
                          <option key={t.valor} value={t.valor}>
                            {t.etiqueta}
                          </option>
                        ))}
                      </select>
                      {l.tratamientoImpuesto === 'other' ? (
                        <input
                          type="number"
                          step="any"
                          min="0"
                          max="100"
                          className={styles.numero}
                          defaultValue={l.tasaImpuesto ?? ''}
                          readOnly={!editable}
                          placeholder="alícuota"
                          aria-label="Alícuota"
                          onBlur={(e) =>
                            commit(
                              l,
                              'tasaImpuesto',
                              l.tasaImpuesto,
                              e.target.value === '' ? null : aNumero(e.target.value),
                            )
                          }
                        />
                      ) : null}
                    </td>
                  </>
                )}

                <td className={styles.derecha}>
                  {l.tipoLinea === 'chapter' ? '' : formatearImporte(netoDeLinea(l), moneda)}
                </td>

                {editable ? (
                  <td className={styles.acciones}>
                    <button
                      type="button"
                      className={styles.icono}
                      onClick={() => onMover(l.id, -1)}
                      disabled={i === 0}
                      aria-label="Subir"
                      title="Subir"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={styles.icono}
                      onClick={() => onMover(l.id, 1)}
                      disabled={i === lineas.length - 1}
                      aria-label="Bajar"
                      title="Bajar"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={styles.icono}
                      onClick={() => onEliminar(l.id)}
                      aria-label="Eliminar línea"
                      title="Eliminar"
                    >
                      ×
                    </button>
                  </td>
                ) : null}
              </tr>
            )
          })}
          {lineas.length === 0 ? (
            <tr>
              <td colSpan={editable ? 9 : 8} className={styles.vacio}>
                Todavía no hay líneas.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}
