import { TRATAMIENTOS, tasaDe } from '../lib/tratamientos'
import { formatearImporte } from '../lib/formato'
import type { LineaAFacturar } from '../services/facturas'
import styles from './LineasLibresFactura.module.css'

export interface LineasLibresFacturaProps {
  lineas: readonly LineaAFacturar[]
  moneda: string
  editable: boolean
  onCambiar: (indice: number, cambios: Partial<LineaAFacturar>) => void
  onAgregar: () => void
  onQuitar: (indice: number) => void
}

function aNumero(v: string): number {
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * Las líneas de la factura que no vienen de ninguna recepción.
 *
 * Un flete, un seguro, un gasto administrativo, una diferencia. El proveedor
 * las factura y hay que poder cargarlas, pero **no salen de mercadería que
 * llegó**: no tienen `goods_receipt_line_id`, no se comparan contra nada y
 * **no mueven stock** —ninguna línea de factura mueve stock, el stock entró
 * con la recepción—.
 *
 * Van en su propio bloque, separado de la grilla, para que se vea de un
 * vistazo qué parte de la factura corresponde a mercadería y qué parte no.
 */
export function LineasLibresFactura({
  lineas,
  moneda,
  editable,
  onCambiar,
  onAgregar,
  onQuitar,
}: LineasLibresFacturaProps) {
  return (
    <div className={styles.bloque}>
      <header className={styles.encabezado}>
        <h3 className={styles.titulo}>Conceptos sin recepción</h3>
        {editable ? (
          <button type="button" className={styles.secundario} onClick={onAgregar}>
            + Flete, seguro, gasto…
          </button>
        ) : null}
      </header>

      {lineas.length === 0 ? (
        <p className={styles.nota}>
          Ninguno. Acá van el flete, el seguro, los gastos y las diferencias que el proveedor
          factura y que no salen de mercadería recibida. No mueven stock.
        </p>
      ) : (
        <ul className={styles.lista}>
          {lineas.map((l, i) => (
            <li key={i} className={styles.item}>
              <label className={styles.campo}>
                <span className={styles.etiqueta}>Concepto</span>
                <input
                  className={styles.control}
                  value={l.descripcion ?? ''}
                  readOnly={!editable}
                  placeholder="Flete internacional"
                  aria-label={`Concepto de la línea libre ${i + 1}`}
                  onChange={(e) => onCambiar(i, { descripcion: e.target.value })}
                />
              </label>

              <div className={styles.numeros}>
                <label className={styles.campoChico}>
                  <span className={styles.etiqueta}>Cantidad</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    inputMode="decimal"
                    className={styles.control}
                    value={l.cantidad === 0 ? '' : l.cantidad}
                    readOnly={!editable}
                    placeholder="1"
                    aria-label={`Cantidad de la línea libre ${i + 1}`}
                    onChange={(e) => onCambiar(i, { cantidad: aNumero(e.target.value) })}
                  />
                </label>

                <label className={styles.campoChico}>
                  <span className={styles.etiqueta}>Importe</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    inputMode="decimal"
                    className={styles.control}
                    value={l.precioUnitario === 0 ? '' : l.precioUnitario}
                    readOnly={!editable}
                    placeholder="0"
                    aria-label={`Importe de la línea libre ${i + 1}`}
                    onChange={(e) => onCambiar(i, { precioUnitario: aNumero(e.target.value) })}
                  />
                </label>

                <label className={styles.campoChico}>
                  <span className={styles.etiqueta}>Impuesto</span>
                  <select
                    className={styles.control}
                    value={l.tratamientoImpuesto}
                    disabled={!editable}
                    aria-label={`Impuesto de la línea libre ${i + 1}`}
                    onChange={(e) =>
                      onCambiar(i, {
                        tratamientoImpuesto: e.target.value,
                        tasaImpuesto: tasaDe(e.target.value),
                      })
                    }
                  >
                    {TRATAMIENTOS.map((t) => (
                      <option key={t.valor} value={t.valor}>
                        {t.etiqueta}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <p className={styles.neto}>
                Neto {formatearImporte(l.cantidad * l.precioUnitario, moneda)}
              </p>

              {editable ? (
                <button
                  type="button"
                  className={styles.quitar}
                  aria-label={`Quitar la línea libre ${i + 1}`}
                  onClick={() => onQuitar(i)}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
