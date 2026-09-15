import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DocSection } from '@/components/document/DocSection'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import tabla from '@/components/tables/Tabla.module.css'
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
const LINEA = { singular: 'línea', plural: 'líneas' }

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
 *
 * Fase 13 · E4: secciones, tabla común y la variación con ícono y texto
 * («sube 3,2 %»), no con ▲▼ sueltos.
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
      <Alert tone="danger" role="alert" title="No se pudieron calcular los precios">
        <p>{ultimos.error?.message ?? historial.error?.message}</p>
      </Alert>
    )
  }

  if (ultimos.isPending) return <SkeletonRows rows={4} columns={5} label="Calculando precios…" />

  if ((ultimos.data ?? []).length === 0) {
    return (
      <EmptyState
        compact
        headingLevel={3}
        icon="bar-chart"
        title="Sin precios cotizados"
        description="A este cliente todavía no se le cotizó ningún producto con precio."
      />
    )
  }

  return (
    <div className={styles.wrap}>
      <DocSection title="Último precio por producto">
        <p className={styles.aclaracion}>
          Una fila por producto <strong>y por moneda</strong>. No se convierte ni se compara entre monedas.
        </p>

        {monedas.length > 1 ? (
          <div className={styles.chips} role="group" aria-label="Moneda">
            <button type="button" className={moneda === null ? styles.chipActivo : styles.chip} aria-pressed={moneda === null} onClick={() => setMoneda(null)}>
              Todas
            </button>
            {monedas.map((m) => (
              <button key={m} type="button" className={moneda === m ? styles.chipActivo : styles.chip} aria-pressed={moneda === m} onClick={() => setMoneda(m)}>
                {m === '' ? 'Sin moneda' : m}
              </button>
            ))}
          </div>
        ) : null}

        <div className={tabla.contenedor}>
          <table className={tabla.tabla}>
            <thead>
              <tr>
                <th scope="col">SKU</th>
                <th scope="col">Producto</th>
                <th scope="col">Moneda</th>
                <th scope="col" className={tabla.num}>
                  Último precio
                </th>
                <th scope="col" className={tabla.num}>
                  Anterior
                </th>
                <th scope="col">Fecha</th>
                <th scope="col">Documento</th>
                <th scope="col" className={tabla.num}>
                  Veces
                </th>
              </tr>
            </thead>
            <tbody>
              {resumen.map((u) => {
                const v = variacion(u)
                return (
                  <tr key={`${u.productId ?? u.sku}-${u.moneda ?? ''}`}>
                    <td className={tabla.nowrap}>
                      <code className={styles.sku}>{u.sku ?? '—'}</code>
                    </td>
                    <td className={tabla.texto} title={u.nombre ?? ''}>
                      {u.nombre ?? '—'}
                    </td>
                    <td className={tabla.nowrap}>{u.moneda ?? <span className={styles.falta}>Sin moneda</span>}</td>
                    <td className={tabla.num}>{formatearImporte(u.ultimoPrecio, u.moneda)}</td>
                    <td className={tabla.num}>
                      {u.precioAnterior === null ? (
                        '—'
                      ) : (
                        <>
                          {formatearImporte(u.precioAnterior, u.moneda)}
                          {v !== null ? (
                            <span className={v >= 0 ? styles.sube : styles.baja}>
                              <Icon name={v >= 0 ? 'arrow-up' : 'arrow-down'} size={16} />
                              <span className="sr-only">{v >= 0 ? 'sube' : 'baja'}</span>
                              {Math.abs(v).toFixed(1)} %
                            </span>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className={tabla.nowrap}>{formatearFecha(u.ultimaFecha)}</td>
                    <td className={tabla.nowrap}>
                      <Link className={tabla.enlace} to={RUTA[u.ultimoTipo]}>
                        {u.ultimoDocumento ?? '—'}
                      </Link>
                    </td>
                    <td className={tabla.num}>{u.veces}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </DocSection>

      <DocSection title="Todas las líneas con precio">
        <div className={tabla.contenedor}>
          <table className={tabla.tabla}>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Documento</th>
                <th scope="col">SKU</th>
                <th scope="col">Producto</th>
                <th scope="col" className={tabla.num}>
                  Cantidad
                </th>
                <th scope="col" className={tabla.num}>
                  Precio
                </th>
                <th scope="col" className={tabla.num}>
                  Dto.
                </th>
                <th scope="col">Moneda</th>
              </tr>
            </thead>
            <tbody>
              {(historial.data?.filas ?? []).map((l, i) => (
                <tr key={`${l.documentoId}-${l.sku ?? i}-${i}`}>
                  <td className={tabla.nowrap}>{formatearFecha(l.fecha)}</td>
                  <td className={tabla.nowrap}>
                    <Link className={tabla.enlace} to={`${RUTA[l.tipo]}/${l.documentoId}`}>
                      {l.numero}
                    </Link>
                    <span className={tabla.secundario}> {ETIQUETA[l.tipo]}</span>
                  </td>
                  <td className={tabla.nowrap}>
                    <code className={styles.sku}>{l.sku ?? '—'}</code>
                  </td>
                  <td className={tabla.texto} title={l.nombre ?? ''}>
                    {l.nombre ?? '—'}
                  </td>
                  <td className={tabla.num}>{l.cantidad ?? '—'}</td>
                  <td className={tabla.num}>{formatearImporte(l.precio, null)}</td>
                  <td className={tabla.num}>{l.descuentoPct ? `${l.descuentoPct} %` : '—'}</td>
                  <td className={tabla.nowrap}>{l.moneda ?? <span className={styles.falta}>Sin moneda</span>}</td>
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
          sustantivo={LINEA}
          onIr={setPagina}
          onTamano={(n) => {
            setPorPagina(n)
            setPagina(1)
          }}
        />
      </DocSection>
    </div>
  )
}
