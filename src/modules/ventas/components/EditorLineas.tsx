import { TRATAMIENTOS } from '../lib/tratamientos'
import { formatearImporte } from '../lib/formato'
import { netoDeLinea } from '../lib/totales'
import type { LineaDocumento } from '../types'
import styles from './EditorLineas.module.css'

export type CampoLinea =
  | 'sku_snapshot'
  | 'name_snapshot'
  | 'description_snapshot'
  | 'quantity'
  | 'unit_price'
  | 'discount_pct'
  | 'tax_treatment'
  | 'tax_rate_snapshot'

export interface EditorLineasProps {
  lineas: readonly LineaDocumento[]
  moneda: string
  /** `false` deja la tabla en sólo lectura sin cambiar el layout. */
  editable: boolean
  onCambiar: (lineaId: string, campo: CampoLinea, valor: string | number | null) => void
  onEliminar: (lineaId: string) => void
  onMover: (lineaId: string, direccion: -1 | 1) => void
}

function aNumero(v: string): number {
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/**
 * La tabla de líneas del editor.
 *
 * Cada línea tiene su propio `id` y su `line_no`: el orden es un dato, no la
 * posición en un array. En el legacy el índice ERA la identidad, y de ahí
 * salió el `entregado[idx]` que hubo que reconstruir en Stage 2.5.
 *
 * Cada campo se guarda al salir del control (`onBlur`) y sólo si cambió. No
 * hay autosave por temporizador: no hay writes duplicados ni bucles, y el
 * total que se ve siempre es el que devolvió el servidor.
 */
export function EditorLineas({
  lineas,
  moneda,
  editable,
  onCambiar,
  onEliminar,
  onMover,
}: EditorLineasProps) {
  const commit = (
    l: LineaDocumento,
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
              Precio
            </th>
            <th scope="col" className={styles.derecha}>
              % Dto.
            </th>
            <th scope="col">Impuesto</th>
            <th scope="col" className={styles.derecha}>
              Subtotal
            </th>
            {editable ? <th scope="col" aria-label="Acciones" /> : null}
          </tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <tr key={l.id} className={l.tipoLinea === 'chapter' ? styles.capitulo : undefined}>
              <td className={styles.num}>{l.numeroLinea ?? i + 1}</td>

              {l.tipoLinea === 'chapter' ? (
                <td colSpan={editable ? 6 : 6}>
                  <input
                    className={styles.texto}
                    defaultValue={l.nombre ?? ''}
                    readOnly={!editable}
                    aria-label="Título del capítulo"
                    onBlur={(e) => commit(l, 'name_snapshot', l.nombre, e.target.value)}
                  />
                </td>
              ) : (
                <>
                  <td>
                    <input
                      className={styles.sku}
                      defaultValue={l.sku ?? ''}
                      readOnly={!editable || l.productId !== null}
                      aria-label="Referencia"
                      onBlur={(e) => commit(l, 'sku_snapshot', l.sku, e.target.value || null)}
                    />
                  </td>
                  <td>
                    <input
                      className={styles.texto}
                      defaultValue={l.nombre ?? ''}
                      readOnly={!editable}
                      aria-label="Descripción"
                      onBlur={(e) => commit(l, 'name_snapshot', l.nombre, e.target.value || null)}
                    />
                  </td>
                  <td className={styles.derecha}>
                    <input
                      type="number"
                      step="any"
                      className={styles.numero}
                      defaultValue={l.cantidad}
                      readOnly={!editable}
                      aria-label="Cantidad"
                      onBlur={(e) => commit(l, 'quantity', l.cantidad, aNumero(e.target.value))}
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
                      aria-label="Precio unitario"
                      onBlur={(e) =>
                        commit(l, 'unit_price', l.precioUnitario, aNumero(e.target.value))
                      }
                    />
                  </td>
                  <td className={styles.derecha}>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      max="100"
                      className={styles.numero}
                      defaultValue={l.descuentoPct ?? 0}
                      readOnly={!editable}
                      aria-label="Descuento"
                      onBlur={(e) =>
                        commit(l, 'discount_pct', l.descuentoPct, aNumero(e.target.value))
                      }
                    />
                  </td>
                  <td>
                    <select
                      className={styles.select}
                      value={l.tratamientoImpuesto ?? 'vat_21'}
                      disabled={!editable}
                      aria-label="Tratamiento de impuesto"
                      onChange={(e) => onCambiar(l.id, 'tax_treatment', e.target.value)}
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
                        defaultValue={l.tasaImpuesto ?? 0}
                        readOnly={!editable}
                        aria-label="Alícuota"
                        onBlur={(e) =>
                          commit(l, 'tax_rate_snapshot', l.tasaImpuesto, aNumero(e.target.value))
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
          ))}
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
