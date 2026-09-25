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
  /** `false` deja el editor en sólo lectura sin cambiar el layout. */
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
 * Las líneas del editor, una ficha por línea.
 *
 * **Era una tabla de diez columnas** (Fase 15 · E2 … Fase 28 · E11), y en la
 * columna del editor —que mide 26 rem al lado de la hoja— no entraba: había
 * que desplazarla a lo ancho para ver el precio, y a lo ancho de nuevo para
 * ver el impuesto. Nadie puede leer una línea así de una sola vez.
 *
 * Ahora cada línea es una ficha con sus campos en dos columnas, como el
 * sistema anterior: arriba el tipo y la referencia con los botones de mover y
 * borrar; después el nombre a todo lo ancho, porque es lo que se lee primero;
 * y abajo precio, descuento, unidades y subtotal en pares, la descripción
 * completa y, al final, la referencia editable y el impuesto.
 *
 * Lo que NO cambió y sigue importando:
 *
 * · Cada línea tiene su propio `id` y su `line_no`: el orden es un dato, no la
 *   posición en un array. En el legacy el índice ERA la identidad, y de ahí
 *   salió el `entregado[idx]` que hubo que reconstruir en Stage 2.5.
 * · Los controles son CONTROLADOS (`value` + `onChange`), no `defaultValue` +
 *   `onBlur`. Con `defaultValue` el «Descartar» restauraba los datos pero
 *   dejaba en pantalla lo tipeado — un descarte que se ve a medias no es un
 *   descarte.
 * · Cada cambio va al BORRADOR. Este componente no escribe en la base.
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
  if (lineas.length === 0) {
    return <p className={styles.vacio}>Todavía no hay líneas.</p>
  }

  return (
    <ul className={styles.fichas} aria-label={`Líneas ${documento}, en edición`}>
      {lineas.map((l, i) => (
        <li key={l.id} className={l.tipoLinea === 'chapter' ? `${styles.ficha} ${styles.fichaNota}` : styles.ficha}>
          <div className={styles.cabecera}>
            <span className={styles.tipo}>{etiquetaDeTipo(l)}</span>
            <code className={styles.refCabecera}>{l.tipoLinea === 'chapter' ? '' : (l.sku ?? '—')}</code>
            <span className={styles.numeroLinea}>#{l.numeroLinea ?? i + 1}</span>
            {editable ? (
              <span className={styles.acciones}>
                <IconButton icon="arrow-up" aria-label="Subir" size="sm" onClick={() => onMover(l.id, -1)} disabled={i === 0} />
                <IconButton icon="arrow-down" aria-label="Bajar" size="sm" onClick={() => onMover(l.id, 1)} disabled={i === lineas.length - 1} />
                <IconButton icon="trash" aria-label="Eliminar línea" size="sm" variant="danger" onClick={() => onEliminar(l.id)} />
              </span>
            ) : null}
          </div>

          {l.tipoLinea === 'chapter' ? (
            /* Fase 28 · E11: una nota es UNA caja de texto —dónde se entrega,
               una aclaración— y nada más. Sin referencia, sin cantidad y sin
               importe: no es una línea que se cobre. */
            <input
              className={styles.nombre}
              value={l.nombre ?? ''}
              readOnly={!editable}
              placeholder="Escribí una nota: dónde se entrega, una aclaración…"
              aria-label="Nota del documento"
              onChange={(e) => onCambiar(l.id, 'name_snapshot', e.target.value || null)}
            />
          ) : (
            <>
              {/* El nombre va solo y a todo lo ancho: es lo que se lee primero. */}
              <input
                className={styles.nombre}
                value={l.nombre ?? ''}
                readOnly={!editable}
                placeholder="Nombre del producto"
                aria-label="Producto"
                onChange={(e) => onCambiar(l.id, 'name_snapshot', e.target.value || null)}
              />

              <div className={styles.grilla}>
                <Campo etiqueta="Precio unit.">
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
                </Campo>
                <Campo etiqueta="Dto. %">
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
                </Campo>
                <Campo etiqueta="Uds.">
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
                </Campo>
                {/* El subtotal se calcula: se muestra, no se escribe. */}
                <Campo etiqueta="Subtotal">
                  <output className={styles.subtotal}>{formatearImporte(netoDeLinea(l), moneda)}</output>
                </Campo>
              </div>

              <Campo etiqueta="Descripción (se imprime)" ancho>
                <textarea
                  className={styles.descripcion}
                  value={l.descripcion ?? ''}
                  readOnly={!editable}
                  rows={3}
                  placeholder="Texto comercial"
                  aria-label="Descripción de la línea"
                  onChange={(e) => onCambiar(l.id, 'description_snapshot', e.target.value || null)}
                />
              </Campo>

              <div className={styles.grilla}>
                <Campo etiqueta="Ref.">
                  <input
                    className={styles.sku}
                    value={l.sku ?? ''}
                    // Un SKU del catálogo no se reescribe a mano: la línea ya
                    // apunta al producto y el texto sería una mentira.
                    readOnly={!editable || l.productId !== null}
                    aria-label="Referencia"
                    onChange={(e) => onCambiar(l.id, 'sku_snapshot', e.target.value || null)}
                  />
                </Campo>
                <Campo etiqueta="Impuesto">
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
                </Campo>
              </div>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

/** El tipo de línea, en la esquina, como el sistema anterior. */
function etiquetaDeTipo(l: LineaDocumento): string {
  if (l.tipoLinea === 'chapter') return 'NOTA'
  if (l.tipoLinea === 'service') return 'SERV'
  return l.productId !== null ? 'PROD' : 'LIBRE'
}

/**
 * Etiqueta arriba y control abajo.
 *
 * Es un `<label>` de verdad y no un `aria-label` suelto: el texto visible y el
 * nombre accesible tienen que ser el mismo, o quien dicta por voz pide
 * «precio unitario» y no pasa nada.
 */
function Campo({ etiqueta, ancho = false, children }: { etiqueta: string; ancho?: boolean; children: React.ReactNode }) {
  return (
    <label className={ancho ? `${styles.campo} ${styles.campoAncho}` : styles.campo}>
      <span className={styles.etiqueta}>{etiqueta}</span>
      {children}
    </label>
  )
}
