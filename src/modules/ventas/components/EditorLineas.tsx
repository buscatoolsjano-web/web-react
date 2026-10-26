import { IconButton } from '@/components/ui/IconButton'
import type { UltimoPrecio } from '@/modules/clientes/types'
import { TRATAMIENTOS } from '../lib/tratamientos'
import { formatearImporte } from '../lib/formato'
import { netoDeLinea } from '../lib/totales'
import { avisoDePrecio } from '../lib/ultimoPrecio'
import type { LineaDocumento } from '../types'
import styles from './EditorLineas.module.css'

/** Una sola instancia: un `new Map()` por render rompería las memos. */
const SIN_HISTORICO: Map<string, UltimoPrecio> = new Map()

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
  /**
   * El último precio de este cliente por producto (Fase 40).
   *
   * Llega como PROP y no de una consulta acá adentro: este componente no lee ni
   * escribe en la base, es una ficha que dibuja lo que le dan, y la página ya
   * pide el histórico para el modal del catálogo. Así se pide una sola vez.
   */
  historicos?: Map<string, UltimoPrecio> | undefined
  onCambiar: (lineaId: string, campo: CampoLinea, valor: string | number | null) => void
  onEliminar: (lineaId: string) => void
  onMover: (lineaId: string, direccion: -1 | 1) => void
}

function aNumero(v: string): number {
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/**
 * Las líneas del editor, UNA FILA por línea (Fase 150).
 *
 * Fue una tabla de diez columnas, después una ficha por línea (Fase 15 → 28) y
 * ahora vuelve a ser una tabla, a pedido: «que sea como el STEL, que en una fila
 * esté todo así entran muchas juntas y se leen bien». La ficha servía cuando el
 * editor vivía en una columna de 26 rem al lado de la hoja; ahora el editor ocupa
 * todo el ancho, y ahí la tabla densa es lo que se quiere. En una pantalla angosta
 * la tabla scrollea de costado en vez de romper el layout.
 *
 * Cada fila: mover (izquierda), referencia, nombre, descripción, precio, unidades,
 * descuento, impuesto, subtotal y borrar (derecha). Una NOTA ocupa la fila entera
 * con una sola caja de texto.
 *
 * Lo que NO cambió:
 *
 * · Cada línea tiene su `id` y su `line_no`: el orden es un dato, no la posición.
 * · Los controles son CONTROLADOS (`value` + `onChange`): «Descartar» restaura de
 *   verdad, sin dejar lo tipeado a la vista.
 * · Cada cambio va al BORRADOR; este componente no escribe en la base.
 */
export function EditorLineas({
  lineas,
  moneda,
  editable,
  documento = 'de la cotización',
  historicos = SIN_HISTORICO,
  onCambiar,
  onEliminar,
  onMover,
}: EditorLineasProps) {
  if (lineas.length === 0) {
    return <p className={styles.vacio}>Todavía no hay líneas.</p>
  }

  return (
    <div className={styles.marco}>
      <table className={styles.tabla} aria-label={`Líneas ${documento}, en edición`}>
        <colgroup>
          {editable ? <col className={styles.colMover} /> : null}
          <col className={styles.colRef} />
          <col className={styles.colNombre} />
          <col className={styles.colDesc} />
          <col className={styles.colNum} />
          <col className={styles.colUds} />
          <col className={styles.colDto} />
          <col className={styles.colImp} />
          <col className={styles.colSub} />
          {editable ? <col className={styles.colBorrar} /> : null}
        </colgroup>
        <thead>
          <tr>
            {editable ? <th scope="col"><span className="sr-only">Mover</span></th> : null}
            <th scope="col">Referencia</th>
            <th scope="col">Nombre</th>
            <th scope="col">Descripción</th>
            <th scope="col" className={styles.num}>Precio</th>
            <th scope="col" className={styles.num}>Uds.</th>
            <th scope="col" className={styles.num}>% Dto.</th>
            <th scope="col">Imp.</th>
            <th scope="col" className={styles.num}>Subtotal</th>
            {editable ? <th scope="col"><span className="sr-only">Borrar</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => {
            const mover = editable ? (
              <td className={styles.celdaMover}>
                <IconButton icon="arrow-up" aria-label="Subir" size="sm" onClick={() => onMover(l.id, -1)} disabled={i === 0} />
                <IconButton icon="arrow-down" aria-label="Bajar" size="sm" onClick={() => onMover(l.id, 1)} disabled={i === lineas.length - 1} />
              </td>
            ) : null
            const borrar = editable ? (
              <td className={styles.celdaBorrar}>
                <IconButton icon="trash" aria-label="Eliminar línea" size="sm" variant="danger" onClick={() => onEliminar(l.id)} />
              </td>
            ) : null

            if (l.tipoLinea === 'chapter') {
              /* Una nota es UNA caja de texto —dónde se entrega, una aclaración—
                 y nada más: sin referencia, cantidad ni importe. Ocupa la fila. */
              return (
                <tr key={l.id} className={styles.filaNota}>
                  {mover}
                  <td colSpan={8}>
                    <input
                      className={styles.nota}
                      value={l.nombre ?? ''}
                      readOnly={!editable}
                      placeholder="Escribí una nota: dónde se entrega, una aclaración…"
                      aria-label="Nota del documento"
                      onChange={(e) => onCambiar(l.id, 'name_snapshot', e.target.value || null)}
                    />
                  </td>
                  {borrar}
                </tr>
              )
            }

            const aviso = l.productId
              ? avisoDePrecio(historicos.get(l.productId), l.precioUnitario ?? 0)
              : null

            return (
              <tr key={l.id}>
                {mover}
                {/* Un SKU del catálogo no se reescribe a mano: la línea ya apunta
                    al producto y el texto sería una mentira. */}
                <td>
                  <input
                    className={styles.sku}
                    value={l.sku ?? ''}
                    readOnly={!editable || l.productId !== null}
                    aria-label="Referencia"
                    onChange={(e) => onCambiar(l.id, 'sku_snapshot', e.target.value || null)}
                  />
                </td>
                <td>
                  <input
                    className={styles.texto}
                    value={l.nombre ?? ''}
                    readOnly={!editable}
                    placeholder="Nombre del producto"
                    aria-label="Producto"
                    onChange={(e) => onCambiar(l.id, 'name_snapshot', e.target.value || null)}
                  />
                </td>
                <td>
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
                <td className={styles.num}>
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
                  {/* El último precio de este cliente: naranja cuando el de la
                      línea no coincide (y dice cuál era, de qué documento y
                      cuándo), gris cuando sí. `role="status"`, no `alert`: es
                      información al lado del campo, no un error. */}
                  {aviso ? (
                    <p role="status" className={aviso.tono === 'historico' ? styles.avisoHistorico : styles.avisoIgual}>
                      {aviso.texto}
                    </p>
                  ) : null}
                </td>
                <td className={styles.num}>
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
                <td className={styles.num}>
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
                {/* El subtotal se calcula: se muestra, no se escribe. */}
                <td className={styles.num}>
                  <output className={styles.subtotal}>{formatearImporte(netoDeLinea(l), moneda)}</output>
                </td>
                {borrar}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
