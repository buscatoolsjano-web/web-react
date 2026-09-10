import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePreciosHistoricos, useUltimosPrecios } from '../hooks/useMemoriaYPrecios'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { Paginador } from './Paginador'
import type { UltimoPrecio } from '../types'
import styles from './PanelPrecios.module.css'

export interface PanelPreciosProps {
  clienteId: string
}

const RUTA = { cotizacion: '/ventas/cotizaciones', pedido: '/ventas/pedidos' } as const
const ETIQUETA = { cotizacion: 'Cotización', pedido: 'Pedido' } as const

/** Cuánto cambió el precio, en porcentaje. `null` si no hay con qué comparar. */
function variacion(u: UltimoPrecio): number | null {
  if (u.ultimoPrecio === null || u.precioAnterior === null || u.precioAnterior === 0) return null
  return ((u.ultimoPrecio - u.precioAnterior) / u.precioAnterior) * 100
}

/**
 * Precios que se le cotizaron a este cliente.
 *
 * **No hay memoria de precios.** El legacy guardaba un caché en
 * `localStorage` —`bterp_price_memory`— con el último precio por cliente y
 * SKU, sin moneda. Acá todo se deriva de las líneas de cotizaciones y pedidos,
 * que es donde el precio quedó escrito de verdad, y el cálculo lo hace el
 * servidor.
 *
 * El resumen de arriba responde «¿a qué precio se le cotizó la última vez?»
 * **por moneda**. Un producto cotizado en USD y en ARS aparece dos veces: son
 * dos respuestas distintas y compararlas entre sí no significaría nada.
 */
export function PanelPrecios({ clienteId }: PanelPreciosProps) {
  const [pagina, setPagina] = useState(1)
  const [porPagina, setPorPagina] = useState(25)
  const [moneda, setMoneda] = useState<string | null>(null)

  const ultimos = useUltimosPrecios(clienteId)
  const historial = usePreciosHistoricos(clienteId, pagina, porPagina, null)

  const monedas = [...new Set((ultimos.data ?? []).map((u) => u.moneda ?? ''))].sort()
  const resumen = (ultimos.data ?? []).filter(
    (u) => moneda === null || (u.moneda ?? '') === moneda,
  )

  if (ultimos.error || historial.error) {
    return (
      <p className={styles.error} role="alert">
        {ultimos.error?.message ?? historial.error?.message}
      </p>
    )
  }

  if (ultimos.isPending) return <p className={styles.nota}>Calculando precios…</p>

  if ((ultimos.data ?? []).length === 0) {
    return (
      <p className={styles.nota}>
        A este cliente todavía no se le cotizó ningún producto con precio.
      </p>
    )
  }

  return (
    <div className={styles.wrap}>
      <section>
        <h3 className={styles.h3}>Último precio por producto</h3>
        <p className={styles.aclaracion}>
          Una fila por producto <strong>y por moneda</strong>. No se convierte ni se compara
          entre monedas.
        </p>

        {monedas.length > 1 ? (
          <div className={styles.chips}>
            <button
              type="button"
              className={moneda === null ? styles.chipActivo : styles.chip}
              onClick={() => setMoneda(null)}
            >
              Todas
            </button>
            {monedas.map((m) => (
              <button
                key={m}
                type="button"
                className={moneda === m ? styles.chipActivo : styles.chip}
                onClick={() => setMoneda(m)}
              >
                {m === '' ? 'Sin moneda' : m}
              </button>
            ))}
          </div>
        ) : null}

        <div className={styles.scroll}>
          <table className={styles.tabla}>
            <thead>
              <tr>
                <th scope="col">SKU</th>
                <th scope="col">Producto</th>
                <th scope="col">Moneda</th>
                <th scope="col" className={styles.derecha}>
                  Último precio
                </th>
                <th scope="col" className={styles.derecha}>
                  Anterior
                </th>
                <th scope="col">Fecha</th>
                <th scope="col">Documento</th>
                <th scope="col" className={styles.derecha}>
                  Veces
                </th>
              </tr>
            </thead>
            <tbody>
              {resumen.map((u) => {
                const v = variacion(u)
                return (
                  <tr key={`${u.productId ?? u.sku}-${u.moneda ?? ''}`}>
                    <td className={styles.mono}>{u.sku ?? '—'}</td>
                    <td className={styles.recorte} title={u.nombre ?? ''}>
                      {u.nombre ?? '—'}
                    </td>
                    <td className={styles.nowrap}>
                      {u.moneda ?? <span className={styles.falta}>sin moneda</span>}
                    </td>
                    <td className={styles.derecha}>
                      {formatearImporte(u.ultimoPrecio, u.moneda)}
                    </td>
                    <td className={styles.derecha}>
                      {u.precioAnterior === null ? (
                        '—'
                      ) : (
                        <>
                          {formatearImporte(u.precioAnterior, u.moneda)}
                          {v !== null ? (
                            <span className={v >= 0 ? styles.sube : styles.baja}>
                              {' '}
                              {v >= 0 ? '▲' : '▼'} {Math.abs(v).toFixed(1)} %
                            </span>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className={styles.nowrap}>{formatearFecha(u.ultimaFecha)}</td>
                    <td className={styles.nowrap}>
                      <Link className={styles.enlace} to={RUTA[u.ultimoTipo]}>
                        {u.ultimoDocumento ?? '—'}
                      </Link>
                    </td>
                    <td className={styles.derecha}>{u.veces}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className={styles.h3}>Todas las líneas con precio</h3>
        <div className={styles.scroll}>
          <table className={styles.tabla}>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Documento</th>
                <th scope="col">SKU</th>
                <th scope="col">Producto</th>
                <th scope="col" className={styles.derecha}>
                  Cantidad
                </th>
                <th scope="col" className={styles.derecha}>
                  Precio
                </th>
                <th scope="col" className={styles.derecha}>
                  Dto.
                </th>
                <th scope="col">Moneda</th>
              </tr>
            </thead>
            <tbody>
              {(historial.data?.filas ?? []).map((l, i) => (
                <tr key={`${l.documentoId}-${l.sku ?? i}-${i}`}>
                  <td className={styles.nowrap}>{formatearFecha(l.fecha)}</td>
                  <td className={styles.nowrap}>
                    <Link className={styles.enlace} to={`${RUTA[l.tipo]}/${l.documentoId}`}>
                      {l.numero}
                    </Link>
                    <span className={styles.tipo}> {ETIQUETA[l.tipo]}</span>
                  </td>
                  <td className={styles.mono}>{l.sku ?? '—'}</td>
                  <td className={styles.recorte} title={l.nombre ?? ''}>
                    {l.nombre ?? '—'}
                  </td>
                  <td className={styles.derecha}>{l.cantidad ?? '—'}</td>
                  <td className={styles.derecha}>{formatearImporte(l.precio, null)}</td>
                  <td className={styles.derecha}>
                    {l.descuentoPct ? `${l.descuentoPct} %` : '—'}
                  </td>
                  <td className={styles.nowrap}>
                    {l.moneda ?? <span className={styles.falta}>sin moneda</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Paginador
          pagina={pagina}
          porPagina={porPagina}
          total={historial.data?.total ?? 0}
          cargando={historial.isFetching}
          onIr={setPagina}
          onTamano={(n) => {
            setPorPagina(n)
            setPagina(1)
          }}
        />
      </section>
    </div>
  )
}
