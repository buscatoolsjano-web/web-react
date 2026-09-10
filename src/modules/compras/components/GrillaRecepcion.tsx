import { useMediaQuery } from '@/hooks/useMediaQuery'
import { formatearNumero } from '../lib/formato'
import type { PendienteDeLinea } from '../types'
import styles from './GrillaRecepcion.module.css'

export interface GrillaRecepcionProps {
  lineas: readonly PendienteDeLinea[]
  /** Cuánto se va a recibir de cada línea, por `purchase_order_line_id`. */
  cantidades: ReadonlyMap<string, number>
  editable: boolean
  onCambiar: (purchaseOrderLineId: string, cantidad: number) => void
  onRecibirTodo: () => void
}

function aNumero(v: string): number {
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * La grilla de recepción: qué se pidió, qué llegó y qué falta.
 *
 * Cada fila es una **línea del pedido**, identificada por su
 * `purchase_order_line_id`. Nunca por su posición: en el legacy el índice era
 * la identidad y de ahí salió el `entregado[idx]` que hubo que reconstruir.
 *
 * «En borrador» **no es una reserva**. Los borradores no reservan nada: la
 * cuenta de lo pendiente mira sólo las recepciones confirmadas. Esa columna
 * está para que quien recibe vea que otro papel ya anotó parte de la misma
 * mercadería, y decida con el dato a la vista en vez de enterarse al
 * confirmar. La contracara es que un borrador olvidado no inmoviliza nada.
 *
 * Una línea **sin producto de catálogo** —un flete, un servicio— se puede
 * recibir documentalmente y **no mueve stock**. La fila lo dice.
 *
 * Por debajo de 1024 **no es una tabla**: cada línea es una tarjeta con los
 * datos apilados. La revisión visual midió la tabla en 390px —921px de ancho
 * dentro de una caja de 325, o sea 598px de scroll interno— y era imposible de
 * usar con el dedo: para escribir una cantidad había que arrastrar la tabla a
 * ciegas y se perdía de vista de qué línea se trataba.
 */
export function GrillaRecepcion({
  lineas,
  cantidades,
  editable,
  onCambiar,
  onRecibirTodo,
}: GrillaRecepcionProps) {
  // Tarjetas hasta 1023, tabla desde 1024. El corte NO es el de la app
  // —768— y es a propósito: a 768 el layout ya muestra la barra lateral, así
  // que a esta grilla de nueve columnas le quedan unos 250px de ancho útil,
  // menos que en un teléfono. Se midió: 491px de scroll interno para llegar
  // al campo donde se escribe la cantidad. Es una decisión de ESTE componente
  // por la cantidad de columnas que tiene, no un cambio del breakpoint global.
  const angosto = useMediaQuery('(max-width: 1023px)')
  const algoPendiente = lineas.some((l) => l.pendiente > 0)

  if (lineas.length === 0) {
    return <p className={styles.vacio}>Este pedido no tiene líneas para recibir.</p>
  }

  return (
    <div className={styles.bloque}>
      {editable && algoPendiente ? (
        <div className={styles.acciones}>
          <button type="button" className={styles.secundario} onClick={onRecibirTodo}>
            Recibir todo lo pendiente
          </button>
        </div>
      ) : null}

      {angosto ? (
        <ul className={styles.tarjetas}>
          {lineas.map((l) => {
            const aRecibir = cantidades.get(l.purchaseOrderLineId) ?? 0
            const excede = aRecibir > l.pendiente
            const completa = l.pendiente === 0
            return (
              <li
                key={l.purchaseOrderLineId}
                className={completa ? styles.tarjetaCompleta : styles.tarjeta}
              >
                <p className={styles.tarjetaTitulo}>
                  <span className={styles.tarjetaNum}>{l.numeroLinea}</span>
                  {l.sku ?? '—'}
                </p>
                <p className={styles.tarjetaDescripcion}>
                  {l.descripcion ?? '—'}
                  {l.productId === null ? (
                    <span className={styles.sinStock}>
                      sin producto de catálogo: no mueve stock
                    </span>
                  ) : null}
                </p>

                <dl className={styles.cifras}>
                  <div>
                    <dt>Pedido</dt>
                    <dd>{formatearNumero(l.pedido)}</dd>
                  </div>
                  <div>
                    <dt>Recibido</dt>
                    <dd>{formatearNumero(l.recibido)}</dd>
                  </div>
                  <div>
                    <dt>Pendiente</dt>
                    <dd className={styles.destacado}>{formatearNumero(l.pendiente)}</dd>
                  </div>
                  <div>
                    <dt>Stock actual</dt>
                    <dd>{l.stockActual === null ? '—' : formatearNumero(l.stockActual)}</dd>
                  </div>
                </dl>

                {l.enBorrador > 0 ? (
                  <p className={styles.enBorrador}>
                    {formatearNumero(l.enBorrador)} en borrador ({l.borradores.join(', ')}) ·{' '}
                    <strong>no reservado</strong>
                  </p>
                ) : null}

                {completa ? (
                  <p className={styles.completo}>Esta línea ya llegó completa.</p>
                ) : (
                  <>
                    <label className={styles.campoRecibir}>
                      <span className={styles.campoEtiqueta}>A recibir</span>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        max={l.pendiente}
                        inputMode="decimal"
                        className={excede ? styles.numeroMal : styles.numero}
                        value={aRecibir === 0 ? '' : aRecibir}
                        readOnly={!editable}
                        placeholder="0"
                        aria-label={`A recibir de la línea ${l.numeroLinea}`}
                        aria-invalid={excede ? true : undefined}
                        onChange={(e) => onCambiar(l.purchaseOrderLineId, aNumero(e.target.value))}
                      />
                    </label>
                    {/* El aviso va DENTRO de la tarjeta, al lado del campo. La
                        lista de abajo queda igual, pero en un teléfono con
                        varias líneas el mensaje tiene que estar donde está el
                        error, no al final de todo. */}
                    {excede ? (
                      <p className={styles.errorLinea}>
                        Quedan {formatearNumero(l.pendiente)} pendientes. Con{' '}
                        {formatearNumero(aRecibir)} el servidor lo va a rechazar.
                      </p>
                    ) : null}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
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
                Pedido
              </th>
              <th scope="col" className={styles.derecha}>
                Recibido
              </th>
              <th scope="col" className={styles.derecha}>
                En borrador
              </th>
              <th scope="col" className={styles.derecha}>
                Pendiente
              </th>
              <th scope="col" className={styles.derecha}>
                A recibir
              </th>
              <th scope="col" className={styles.derecha}>
                Stock actual
              </th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => {
              const aRecibir = cantidades.get(l.purchaseOrderLineId) ?? 0
              const excede = aRecibir > l.pendiente
              return (
                <tr key={l.purchaseOrderLineId} className={l.pendiente === 0 ? styles.completa : undefined}>
                  <td className={styles.num}>{l.numeroLinea}</td>
                  <td className={styles.mono}>{l.sku ?? '—'}</td>
                  <td className={styles.descripcion}>
                    {l.descripcion ?? '—'}
                    {l.productId === null ? (
                      <span className={styles.sinStock}>sin producto de catálogo: no mueve stock</span>
                    ) : null}
                  </td>
                  <td className={styles.derecha}>{formatearNumero(l.pedido)}</td>
                  <td className={styles.derecha}>{formatearNumero(l.recibido)}</td>
                  <td className={styles.derecha}>
                    {l.enBorrador > 0 ? (
                      <span
                        className={styles.borrador}
                        title={`Anotado en: ${l.borradores.join(', ')}. No está reservado.`}
                      >
                        {formatearNumero(l.enBorrador)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={styles.derecha}>
                    <strong>{formatearNumero(l.pendiente)}</strong>
                  </td>
                  <td className={styles.derecha}>
                    {l.pendiente === 0 ? (
                      <span className={styles.completo}>completa</span>
                    ) : (
                      <input
                        type="number"
                        step="any"
                        min="0"
                        max={l.pendiente}
                        className={excede ? styles.numeroMal : styles.numero}
                        value={aRecibir === 0 ? '' : aRecibir}
                        readOnly={!editable}
                        placeholder="0"
                        aria-label={`A recibir de la línea ${l.numeroLinea}`}
                        aria-invalid={excede ? true : undefined}
                        onChange={(e) => onCambiar(l.purchaseOrderLineId, aNumero(e.target.value))}
                      />
                    )}
                  </td>
                  <td className={styles.derecha}>
                    {l.stockActual === null ? '—' : formatearNumero(l.stockActual)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      )}

      {lineas.some((l) => (cantidades.get(l.purchaseOrderLineId) ?? 0) > l.pendiente) ? (
        <ul className={styles.problemas} role="alert">
          {lineas
            .filter((l) => (cantidades.get(l.purchaseOrderLineId) ?? 0) > l.pendiente)
            .map((l) => (
              <li key={l.purchaseOrderLineId}>
                Línea {l.numeroLinea}: se quiere recibir{' '}
                {formatearNumero(cantidades.get(l.purchaseOrderLineId) ?? 0)} y quedan{' '}
                {formatearNumero(l.pendiente)} pendientes. El servidor lo va a rechazar.
              </li>
            ))}
        </ul>
      ) : null}

      {lineas.some((l) => l.enBorrador > 0) ? (
        <p className={styles.aviso} role="note">
          Hay cantidades anotadas en otras recepciones <strong>en borrador</strong>. No están
          reservadas: lo pendiente se cuenta sólo con lo ya confirmado. Si las dos se confirman,
          la segunda va a fallar por sobre-recepción.
        </p>
      ) : null}
    </div>
  )
}
