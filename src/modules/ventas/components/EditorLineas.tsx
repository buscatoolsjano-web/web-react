import { IconButton } from '@/components/ui/IconButton'
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
  /** Cómo se nombra el documento en el rótulo para lectores de pantalla. */
  documento?: 'de la cotización' | 'del pedido' | undefined
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
 * Fase 15 · E2, dos cambios que importan:
 *
 * · Los controles son CONTROLADOS (`value` + `onChange`), no `defaultValue` +
 *   `onBlur`. Con `defaultValue` el «Descartar» restauraba los datos pero
 *   dejaba en pantalla lo que la persona había tipeado — un descarte que se
 *   ve a medias no es un descarte.
 * · Cada cambio va al BORRADOR. Este componente no escribe en la base.
 *
 * La columna que antes decía «Descripción» era en realidad el nombre del
 * producto. Ahora son dos: Producto y Descripción, y la segunda es el texto
 * comercial (`description_snapshot`), que se edita sin tocar el catálogo.
 */
export function EditorLineas({
  lineas,
  moneda,
  editable,
  documento = 'de la cotización',
  onCambiar,
  onEliminar,
  onMover,
}: EditorLineasProps) {
  return (
    <div className={styles.scroll}>
      <table className={styles.tabla}>
        <caption className="sr-only">Líneas {documento}, en edición</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.num}>#</th>
            <th scope="col">Referencia</th>
            <th scope="col">Producto</th>
            <th scope="col">Descripción</th>
            <th scope="col" className={styles.derecha}>Cant.</th>
            <th scope="col" className={styles.derecha}>Precio</th>
            <th scope="col" className={styles.derecha}>% Dto.</th>
            <th scope="col">Impuesto</th>
            <th scope="col" className={styles.derecha}>Subtotal</th>
            {editable ? <th scope="col" aria-label="Acciones" /> : null}
          </tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <tr key={l.id} className={l.tipoLinea === 'chapter' ? styles.capitulo : undefined}>
              <td className={styles.num} data-label="#">{l.numeroLinea ?? i + 1}</td>

              {l.tipoLinea === 'chapter' ? (
                /* Fase 28 · E9: un capítulo es una nota —dónde se entrega, una
                   aclaración—, así que lleva título Y texto. Sin referencia,
                   sin cantidad y sin importe: no es una línea que se cobre. */
                <td colSpan={7} className={styles.celdaCapitulo} data-label="Capítulo">
                  <input
                    className={styles.texto}
                    value={l.nombre ?? ''}
                    readOnly={!editable}
                    placeholder="Título de la nota"
                    aria-label="Título del capítulo"
                    onChange={(e) => onCambiar(l.id, 'name_snapshot', e.target.value || null)}
                  />
                  <input
                    className={styles.texto}
                    value={l.descripcion ?? ''}
                    readOnly={!editable}
                    placeholder="Texto de la nota (dónde se entrega, una aclaración…)"
                    aria-label="Texto del capítulo"
                    onChange={(e) => onCambiar(l.id, 'description_snapshot', e.target.value || null)}
                  />
                </td>
              ) : (
                <>
                  <td className={styles.celdaSku} data-label="Referencia">
                    <input
                      className={styles.sku}
                      value={l.sku ?? ''}
                      // Un SKU del catálogo no se reescribe a mano: la línea ya
                      // apunta al producto y el texto sería una mentira.
                      readOnly={!editable || l.productId !== null}
                      aria-label="Referencia"
                      onChange={(e) => onCambiar(l.id, 'sku_snapshot', e.target.value || null)}
                    />
                  </td>
                  <td className={styles.celdaProducto} data-label="Producto">
                    <input
                      className={styles.texto}
                      value={l.nombre ?? ''}
                      readOnly={!editable}
                      aria-label="Producto"
                      onChange={(e) => onCambiar(l.id, 'name_snapshot', e.target.value || null)}
                    />
                  </td>
                  <td className={styles.celdaDescripcion} data-label="Descripción">
                    <textarea
                      className={styles.descripcion}
                      value={l.descripcion ?? ''}
                      readOnly={!editable}
                      rows={1}
                      placeholder="Texto comercial"
                      aria-label="Descripción de la línea"
                      onChange={(e) => onCambiar(l.id, 'description_snapshot', e.target.value || null)}
                    />
                  </td>
                  <td className={`${styles.derecha} ${styles.celdaCantidad}`} data-label="Cant.">
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      className={styles.numero}
                      value={l.cantidad}
                      readOnly={!editable}
                      aria-label="Cantidad"
                      onChange={(e) => onCambiar(l.id, 'quantity', aNumero(e.target.value))}
                    />
                  </td>
                  <td className={`${styles.derecha} ${styles.celdaPrecio}`} data-label="Precio">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      inputMode="decimal"
                      className={styles.numero}
                      value={l.precioUnitario ?? 0}
                      readOnly={!editable}
                      aria-label="Precio unitario"
                      onChange={(e) => onCambiar(l.id, 'unit_price', aNumero(e.target.value))}
                    />
                  </td>
                  <td className={`${styles.derecha} ${styles.celdaDto}`} data-label="% Dto.">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      max="100"
                      inputMode="decimal"
                      className={styles.numero}
                      value={l.descuentoPct ?? 0}
                      readOnly={!editable}
                      aria-label="Descuento"
                      onChange={(e) => onCambiar(l.id, 'discount_pct', aNumero(e.target.value))}
                    />
                  </td>
                  <td className={styles.celdaImpuesto} data-label="Impuesto">
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
                    {/* «Otra alícuota» no tiene tasa por defecto: la escribe quien cotiza. */}
                    {l.tratamientoImpuesto === 'other' ? (
                      <input
                        type="number"
                        step="any"
                        min="0"
                        max="100"
                        inputMode="decimal"
                        className={styles.numero}
                        value={l.tasaImpuesto ?? 0}
                        readOnly={!editable}
                        aria-label="Alícuota"
                        onChange={(e) => onCambiar(l.id, 'tax_rate_snapshot', aNumero(e.target.value))}
                      />
                    ) : null}
                  </td>
                </>
              )}

              <td className={`${styles.derecha} ${styles.celdaSubtotal}`} data-label="Subtotal">
                {l.tipoLinea === 'chapter' ? '' : formatearImporte(netoDeLinea(l), moneda)}
              </td>

              {editable ? (
                <td className={styles.acciones}>
                  <IconButton icon="arrow-up" aria-label="Subir" size="sm" onClick={() => onMover(l.id, -1)} disabled={i === 0} />
                  <IconButton icon="arrow-down" aria-label="Bajar" size="sm" onClick={() => onMover(l.id, 1)} disabled={i === lineas.length - 1} />
                  <IconButton icon="trash" aria-label="Eliminar línea" size="sm" variant="danger" onClick={() => onEliminar(l.id)} />
                </td>
              ) : null}
            </tr>
          ))}
          {lineas.length === 0 ? (
            <tr>
              <td colSpan={editable ? 10 : 9} className={styles.vacio}>
                Todavía no hay líneas.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}
