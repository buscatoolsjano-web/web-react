import { useMediaQuery } from '@/hooks/useMediaQuery'
import { TRATAMIENTOS, etiquetaDeTratamiento, tasaDe } from '../lib/tratamientos'
import { formatearImporte, formatearNumero } from '../lib/formato'
import type { LineaAFacturar } from '../services/facturas'
import type { PendienteDeFacturar } from '../types'
import styles from './GrillaRecepcion.module.css'

/** Lo que se está cargando de cada línea, por `goods_receipt_line_id`. */
export type CargaPorLinea = Map<string, LineaAFacturar>

export interface GrillaFacturaProps {
  pendientes: readonly PendienteDeFacturar[]
  carga: CargaPorLinea
  moneda: string
  editable: boolean
  onCambiar: (goodsReceiptLineId: string, cambios: Partial<LineaAFacturar>) => void
  onFacturarTodo: () => void
}

function aNumero(v: string): number {
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * Qué se recibió, qué se facturó y qué falta facturar.
 *
 * Cada fila es una **línea de recepción**, identificada por su id. El precio
 * arranca en el de la orden de compra —el snapshot de `purchase_order_lines`,
 * nunca un precio de venta del catálogo— y **se puede editar**: la factura
 * real del proveedor puede venir con otro importe, y eso hay que poder
 * cargarlo. Cambiarlo acá **no toca la orden**: la factura guarda su propio
 * snapshot.
 *
 * «En borrador» **no reserva**: es lo que otras facturas en borrador ya
 * anotaron sobre la misma línea. Está para verlo antes, no para bloquear.
 *
 * Por debajo de 1024 son tarjetas y no una tabla, por la misma razón que en
 * recepciones: con la barra lateral abierta a 768 quedan 250px útiles.
 */
export function GrillaFactura({
  pendientes,
  carga,
  moneda,
  editable,
  onCambiar,
  onFacturarTodo,
}: GrillaFacturaProps) {
  const angosto = useMediaQuery('(max-width: 1023px)')
  const algoPendiente = pendientes.some((l) => l.pendiente > 0)

  if (pendientes.length === 0) {
    return (
      <p className={styles.vacio}>
        No hay recepciones confirmadas de este proveedor con algo por facturar.
      </p>
    )
  }

  const filas = pendientes.map((p) => {
    const l = carga.get(p.goodsReceiptLineId)
    return {
      p,
      cantidad: l?.cantidad ?? 0,
      precio: l?.precioUnitario ?? p.precioPedido ?? 0,
      tratamiento: l?.tratamientoImpuesto ?? p.tratamientoPedido ?? 'vat_21',
      excede: (l?.cantidad ?? 0) > p.pendiente,
      difPrecio:
        p.precioPedido !== null &&
        Math.abs((l?.precioUnitario ?? p.precioPedido) - p.precioPedido) > 0.0001,
    }
  })

  return (
    <div className={styles.bloque}>
      {editable && algoPendiente ? (
        <div className={styles.acciones}>
          <button type="button" className={styles.secundario} onClick={onFacturarTodo}>
            Facturar todo lo pendiente
          </button>
        </div>
      ) : null}

      {angosto ? (
        <ul className={styles.tarjetas}>
          {filas.map(({ p, cantidad, precio, tratamiento, excede, difPrecio }) => (
            <li
              key={p.goodsReceiptLineId}
              className={p.pendiente === 0 ? styles.tarjetaCompleta : styles.tarjeta}
            >
              <p className={styles.tarjetaTitulo}>
                <span className={styles.tarjetaNum}>{p.recepcionNumero}</span>
                {p.sku ?? '—'}
              </p>
              <p className={styles.tarjetaDescripcion}>
                {p.descripcion ?? '—'}
                {p.pedidoNumero ? (
                  <span className={styles.sinStock}>pedido {p.pedidoNumero}</span>
                ) : null}
              </p>

              <dl className={styles.cifras}>
                <div>
                  <dt>Recibido</dt>
                  <dd>{formatearNumero(p.recibido)}</dd>
                </div>
                <div>
                  <dt>Facturado</dt>
                  <dd>{formatearNumero(p.facturado)}</dd>
                </div>
                <div>
                  <dt>Pendiente</dt>
                  <dd className={styles.destacado}>{formatearNumero(p.pendiente)}</dd>
                </div>
                <div>
                  <dt>Precio OC</dt>
                  <dd>{formatearImporte(p.precioPedido, moneda)}</dd>
                </div>
              </dl>

              {p.enBorrador > 0 ? (
                <p className={styles.enBorrador}>
                  {formatearNumero(p.enBorrador)} en otra factura en borrador ·{' '}
                  <strong>no reservado</strong>
                </p>
              ) : null}

              {p.pendiente === 0 ? (
                <p className={styles.completo}>Esta línea ya está facturada del todo.</p>
              ) : (
                <>
                  <label className={styles.campoRecibir}>
                    <span className={styles.campoEtiqueta}>A facturar</span>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      max={p.pendiente}
                      inputMode="decimal"
                      className={excede ? styles.numeroMal : styles.numero}
                      value={cantidad === 0 ? '' : cantidad}
                      readOnly={!editable}
                      placeholder="0"
                      aria-label={`A facturar de ${p.recepcionNumero} ${p.sku ?? ''}`}
                      aria-invalid={excede ? true : undefined}
                      onChange={(e) =>
                        onCambiar(p.goodsReceiptLineId, { cantidad: aNumero(e.target.value) })
                      }
                    />
                  </label>

                  <label className={styles.campoRecibir}>
                    <span className={styles.campoEtiqueta}>Precio</span>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      inputMode="decimal"
                      className={styles.numero}
                      value={precio}
                      readOnly={!editable}
                      aria-label={`Precio facturado de ${p.sku ?? p.recepcionNumero}`}
                      onChange={(e) =>
                        onCambiar(p.goodsReceiptLineId, { precioUnitario: aNumero(e.target.value) })
                      }
                    />
                  </label>

                  <label className={styles.campoRecibir}>
                    <span className={styles.campoEtiqueta}>Impuesto</span>
                    <select
                      className={styles.numero}
                      value={tratamiento}
                      disabled={!editable}
                      aria-label={`Impuesto de ${p.sku ?? p.recepcionNumero}`}
                      onChange={(e) =>
                        onCambiar(p.goodsReceiptLineId, {
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

                  {excede ? (
                    <p className={styles.errorLinea}>
                      Quedan {formatearNumero(p.pendiente)} por facturar. Con{' '}
                      {formatearNumero(cantidad)} el servidor lo va a rechazar.
                    </p>
                  ) : null}
                  {difPrecio && cantidad > 0 ? (
                    <p className={styles.enBorrador}>
                      El pedido decía {formatearImporte(p.precioPedido, moneda)}. Se factura{' '}
                      {formatearImporte(precio, moneda)}. El pedido <strong>no se toca</strong>.
                    </p>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.tabla}>
            <thead>
              <tr>
                <th scope="col">Recepción</th>
                <th scope="col">Referencia</th>
                <th scope="col">Descripción</th>
                <th scope="col" className={styles.derecha}>
                  Recibido
                </th>
                <th scope="col" className={styles.derecha}>
                  Facturado
                </th>
                <th scope="col" className={styles.derecha}>
                  Pendiente
                </th>
                <th scope="col" className={styles.derecha}>
                  A facturar
                </th>
                <th scope="col" className={styles.derecha}>
                  Precio
                </th>
                <th scope="col">Impuesto</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(({ p, cantidad, precio, tratamiento, excede, difPrecio }) => (
                <tr
                  key={p.goodsReceiptLineId}
                  className={p.pendiente === 0 ? styles.completa : undefined}
                >
                  <td className={styles.mono}>{p.recepcionNumero}</td>
                  <td className={styles.mono}>{p.sku ?? '—'}</td>
                  <td className={styles.descripcion}>
                    {p.descripcion ?? '—'}
                    {p.pedidoNumero ? (
                      <span className={styles.sinStock}>pedido {p.pedidoNumero}</span>
                    ) : null}
                  </td>
                  <td className={styles.derecha}>{formatearNumero(p.recibido)}</td>
                  <td className={styles.derecha}>
                    {formatearNumero(p.facturado)}
                    {p.enBorrador > 0 ? (
                      <span className={styles.borrador} title="En otra factura en borrador. No reservado.">
                        {' '}
                        +{formatearNumero(p.enBorrador)}
                      </span>
                    ) : null}
                  </td>
                  <td className={styles.derecha}>
                    <strong>{formatearNumero(p.pendiente)}</strong>
                  </td>
                  <td className={styles.derecha}>
                    {p.pendiente === 0 ? (
                      <span className={styles.completo}>facturada</span>
                    ) : (
                      <input
                        type="number"
                        step="any"
                        min="0"
                        max={p.pendiente}
                        className={excede ? styles.numeroMal : styles.numero}
                        value={cantidad === 0 ? '' : cantidad}
                        readOnly={!editable}
                        placeholder="0"
                        aria-label={`A facturar de ${p.recepcionNumero} ${p.sku ?? ''}`}
                        aria-invalid={excede ? true : undefined}
                        onChange={(e) =>
                          onCambiar(p.goodsReceiptLineId, { cantidad: aNumero(e.target.value) })
                        }
                      />
                    )}
                  </td>
                  <td className={styles.derecha}>
                    {p.pendiente === 0 ? null : (
                      <input
                        type="number"
                        step="any"
                        min="0"
                        className={styles.numero}
                        value={precio}
                        readOnly={!editable}
                        title={
                          difPrecio
                            ? `El pedido decía ${formatearImporte(p.precioPedido, moneda)}`
                            : undefined
                        }
                        aria-label={`Precio facturado de ${p.sku ?? p.recepcionNumero}`}
                        onChange={(e) =>
                          onCambiar(p.goodsReceiptLineId, {
                            precioUnitario: aNumero(e.target.value),
                          })
                        }
                      />
                    )}
                    {difPrecio && cantidad > 0 ? (
                      <span className={styles.borrador} title="El pedido no se modifica">
                        ≠ OC
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {p.pendiente === 0 ? (
                      etiquetaDeTratamiento(tratamiento)
                    ) : (
                      <select
                        className={styles.numero}
                        value={tratamiento}
                        disabled={!editable}
                        aria-label={`Impuesto de ${p.sku ?? p.recepcionNumero}`}
                        onChange={(e) =>
                          onCambiar(p.goodsReceiptLineId, {
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
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pendientes.some((p) => p.enBorrador > 0) ? (
        <p className={styles.aviso} role="note">
          Hay cantidades anotadas en otras facturas <strong>en borrador</strong>. No están
          reservadas: lo pendiente se cuenta sólo con las facturas registradas. Si las dos se
          registran, la segunda va a fallar por sobre-facturación.
        </p>
      ) : null}
    </div>
  )
}
