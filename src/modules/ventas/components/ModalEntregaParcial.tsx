import { useMemo, useState } from 'react'
import { formatearCantidad } from '../lib/formato'
import type { LineaParaEntregar } from '../services/entregas'
import styles from './ModalEntregaParcial.module.css'

export interface ModalEntregaParcialProps {
  lineas: readonly LineaParaEntregar[]
  cargando: boolean
  guardando: boolean
  error: string | null
  onConfirmar: (cantidades: Map<string, number>, fecha: string) => void
  onCerrar: () => void
}

const HOY = () => new Date().toISOString().slice(0, 10)

/**
 * Elegir qué se entrega.
 *
 * Cada fila ofrece **el pendiente real**, no la cantidad pedida: si de 100 ya
 * se entregaron 70, acá se ofrecen 30. El campo está acotado a ese pendiente
 * y el servidor lo vuelve a validar con un trigger — el legacy recortaba en
 * silencio con `Math.min`, que entrega una cantidad distinta de la pedida sin
 * decir nada.
 *
 * El stock se muestra, pero **no bloquea**: el sistema anterior descontaba sin
 * mirar el saldo y dejaba que quedara negativo. Migrar el circuito no es el
 * momento de cambiar esa regla, así que se avisa y se deja seguir.
 */
export function ModalEntregaParcial({
  lineas,
  cargando,
  guardando,
  error,
  onConfirmar,
  onCerrar,
}: ModalEntregaParcialProps) {
  const conPendiente = useMemo(() => lineas.filter((l) => l.pendiente > 0), [lineas])
  const [cantidades, setCantidades] = useState<Map<string, number>>(new Map())
  const [fecha, setFecha] = useState(HOY)

  // Arranca con todo el pendiente cargado, que es el caso habitual: entregar
  // todo lo que falta. Ajustar hacia abajo es un caso, no el punto de partida.
  //
  // Se ajusta DURANTE el render y no en un useEffect: llamar a setState dentro
  // de un efecto provoca un render en cascada. Las líneas llegan por una
  // consulta, así que el primer render las tiene vacías y el segundo ya no.
  const [lineasPrevias, setLineasPrevias] = useState(conPendiente)
  if (lineasPrevias !== conPendiente) {
    setLineasPrevias(conPendiente)
    setCantidades(new Map(conPendiente.map((l) => [l.orderLineId, l.pendiente])))
  }

  const poner = (id: string, valor: number, tope: number) =>
    setCantidades((m) => new Map(m).set(id, Math.max(0, Math.min(valor, tope))))

  const total = [...cantidades.values()].reduce((s, n) => s + n, 0)
  const sinStock = conPendiente.filter(
    (l) => l.stockLibre !== null && (cantidades.get(l.orderLineId) ?? 0) > l.stockLibre,
  )

  return (
    <div className={styles.fondo} role="dialog" aria-modal="true" aria-label="Generar remito">
      <div className={styles.caja}>
        <header className={styles.cabecera}>
          <h2 className={styles.titulo}>Generar nota de entrega</h2>
          <button type="button" className={styles.cerrar} onClick={onCerrar} aria-label="Cerrar">
            ×
          </button>
        </header>

        <div className={styles.cuerpo}>
          {cargando ? (
            <p className={styles.nota}>Calculando pendientes…</p>
          ) : conPendiente.length === 0 ? (
            <p className={styles.nota}>
              Este pedido ya está entregado por completo: no queda nada pendiente.
            </p>
          ) : (
            <>
              <label className={styles.fecha}>
                <span>Fecha del remito</span>
                <input
                  type="date"
                  className={styles.control}
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </label>

              <div className={styles.scroll}>
                <table className={styles.tabla}>
                  <thead>
                    <tr>
                      <th scope="col">Referencia</th>
                      <th scope="col" className={styles.derecha}>
                        Pedido
                      </th>
                      <th scope="col" className={styles.derecha}>
                        Entregado
                      </th>
                      <th scope="col" className={styles.derecha}>
                        Pendiente
                      </th>
                      <th scope="col" className={styles.derecha}>
                        Stock libre
                      </th>
                      <th scope="col" className={styles.derecha}>
                        A entregar
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {conPendiente.map((l) => {
                      const valor = cantidades.get(l.orderLineId) ?? 0
                      const falta = l.stockLibre !== null && valor > l.stockLibre
                      return (
                        <tr key={l.orderLineId}>
                          <td>
                            <span className={styles.sku}>{l.sku ?? '—'}</span>
                            <span className={styles.nombre}>{l.nombre ?? ''}</span>
                          </td>
                          <td className={styles.derecha}>{formatearCantidad(l.pedida)}</td>
                          <td className={styles.derecha}>{formatearCantidad(l.entregada)}</td>
                          <td className={styles.derecha}>{formatearCantidad(l.pendiente)}</td>
                          <td className={styles.derecha}>
                            {l.stockLibre === null ? (
                              <span className={styles.sinDato}>sin dato</span>
                            ) : falta ? (
                              <span className={styles.alerta}>{formatearCantidad(l.stockLibre)}</span>
                            ) : (
                              formatearCantidad(l.stockLibre)
                            )}
                          </td>
                          <td className={styles.derecha}>
                            <input
                              type="number"
                              className={styles.numero}
                              min="0"
                              max={l.pendiente}
                              step="any"
                              value={valor}
                              aria-label={`Cantidad a entregar de ${l.sku ?? 'la línea'}`}
                              onChange={(e) =>
                                poner(l.orderLineId, Number(e.target.value), l.pendiente)
                              }
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {sinStock.length > 0 ? (
                <p className={styles.aviso} role="note">
                  {sinStock.length === 1
                    ? 'Una línea supera el stock libre.'
                    : `${sinStock.length} líneas superan el stock libre.`}{' '}
                  El sistema anterior tampoco lo impedía: el remito se puede emitir igual y el
                  saldo queda en negativo.
                </p>
              ) : null}
            </>
          )}

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className={styles.pie}>
          <button type="button" className={styles.secundario} onClick={onCerrar}>
            Cancelar
          </button>
          <button
            type="button"
            className={styles.primario}
            disabled={guardando || total <= 0 || conPendiente.length === 0}
            onClick={() => onConfirmar(cantidades, fecha)}
          >
            {guardando ? 'Generando…' : 'Generar remito'}
          </button>
        </footer>
      </div>
    </div>
  )
}
