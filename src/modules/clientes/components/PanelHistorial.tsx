import { Link } from 'react-router-dom'
import { DocSection } from '@/components/document/DocSection'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import tabla from '@/components/tables/Tabla.module.css'
import { GraficoDoceMeses } from './GraficoDoceMeses'
import { useCliente360 } from '../hooks/useCliente360'
import { useTotalesPorMoneda } from '../hooks/useResumen'
import { etiquetaDeEstado } from '../lib/estados'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { Paginador } from './Paginador'
import type { CandidatoDeOc, DocumentoDeCliente, TipoDeDocumento } from '../types'
import styles from './PanelHistorial.module.css'

export interface PanelHistorialProps {
  clienteId: string
  /** La PÁGINA de documentos, no todos: la paginación es del servidor. */
  documentos: readonly DocumentoDeCliente[]
  /** Cuántos hay en total, para el paginador. */
  total: number
  pagina: number
  porPagina: number
  cargando: boolean
  /** Cambiando de página: la tabla anterior sigue visible, atenuada. */
  recargando?: boolean
  /**
   * Los candidatos de orden de compra que detectó la migración. Vivían en una
   * pestaña propia («Relacionados») que estaba vacía para 991 de los 1.010
   * clientes; son papeles del cliente que aparecieron en sus documentos, así
   * que su lugar es acá.
   */
  candidatosDeOc: readonly CandidatoDeOc[]
  onPagina: (pagina: number) => void
  onTamano: (porPagina: number) => void
}

const DOCUMENTO = { singular: 'documento', plural: 'documentos' }

const RUTA: Record<TipoDeDocumento, string> = {
  cotizacion: '/ventas/cotizaciones',
  pedido: '/ventas/pedidos',
  entrega: '/ventas/entregas',
}

const ETIQUETA: Record<TipoDeDocumento, string> = {
  cotizacion: 'Cotización',
  pedido: 'Pedido',
  entrega: 'Nota de entrega',
}

const PLURAL: Record<TipoDeDocumento, string> = {
  cotizacion: 'cotizaciones',
  pedido: 'pedidos',
  entrega: 'notas de entrega',
}

/**
 * El historial del cliente.
 *
 * Dos cosas que el legacy hacía distinto:
 *
 * 1. Los documentos se traen por `customer_id`. `getDocumentosCliente`
 *    comparaba el nombre del cliente normalizado contra el que estaba escrito
 *    en cada documento; con eso, corregir una tilde borraba media historia.
 *
 * 2. Los totales van **por moneda**, y los calcula el servidor. El panel del
 *    legacy sumaba ARS, USD y EUR en un solo importe; y sumar lo que trajo la
 *    pantalla daría un total que depende de cuántas filas se pidieron.
 *
 * Fase 13 · E4: tres secciones (importes, actividad, documentos) con la tabla
 * común y el estado como `Badge`.
 */
export function PanelHistorial({
  clienteId,
  documentos,
  total,
  pagina,
  porPagina,
  cargando,
  recargando = false,
  candidatosDeOc,
  onPagina,
  onTamano,
}: PanelHistorialProps) {
  const totales = useTotalesPorMoneda(clienteId)
  // La serie del gráfico ya vino con la ficha: `resumen_cliente_360` la trae y
  // React Query la tiene cacheada desde que se abrió la pantalla. Pedirla otra
  // vez con `actividad_mensual_cliente` era un viaje por un dato que ya estaba
  // en memoria — y además dibujaba una serie por vez, mientras que la ficha
  // rápida mostraba las tres. Dos gráficos distintos del mismo cliente.
  const ficha = useCliente360(clienteId)

  // Fase 17 · E4: contar sobre `documentos` contaría la PÁGINA. Los totales
  // por tipo salen de la misma consulta que los importes, que el servidor
  // calcula sobre todos los documentos del cliente.
  const porTipo = { cotizacion: 0, pedido: 0, entrega: 0 }
  for (const t of totales.data ?? []) porTipo[t.tipo] += t.documentos

  // Una caja por moneda, con el desglose por tipo adentro. La moneda manda
  // sobre el tipo porque es lo que hace que dos importes sean comparables.
  const porMoneda = new Map<string, { moneda: string | null; filas: typeof totales.data }>()
  for (const t of totales.data ?? []) {
    const k = t.moneda ?? ''
    const previo = porMoneda.get(k)
    if (previo) previo.filas!.push(t)
    else porMoneda.set(k, { moneda: t.moneda, filas: [t] })
  }
  const monedas = [...porMoneda.values()].sort((a, b) => {
    if (a.moneda === null) return 1
    if (b.moneda === null) return -1
    const da = (a.filas ?? []).reduce((s, f) => s + f.documentos, 0)
    const db = (b.filas ?? []).reduce((s, f) => s + f.documentos, 0)
    if (da !== db) return db - da
    return a.moneda.localeCompare(b.moneda)
  })

  if (cargando) return <SkeletonRows rows={4} columns={5} label="Cargando historial…" />

  if (documentos.length === 0 && pagina === 1) {
    return (
      <EmptyState
        compact
        headingLevel={3}
        icon="inbox"
        title="Sin documentos"
        description="Este cliente todavía no tiene cotizaciones, pedidos ni notas de entrega."
      />
    )
  }

  return (
    <div className={styles.wrap}>
      <DocSection title="Importes por moneda">
        {totales.error ? (
          <Alert tone="danger" role="alert" title="No se pudieron calcular los importes">
            <p>{totales.error.message}</p>
          </Alert>
        ) : (
          <>
            <div className={styles.resumen}>
              {monedas.map((m) => (
                <dl key={m.moneda ?? 'sin'} className={styles.moneda}>
                  <dt className={styles.monedaEtiqueta}>{m.moneda ?? 'Sin moneda'}</dt>
                  {(m.filas ?? []).map((f) => (
                    <dd key={f.tipo} className={styles.linea}>
                      <span className={styles.lineaTipo}>{ETIQUETA[f.tipo]}</span>
                      <span className={styles.lineaValor}>{formatearImporte(f.importe, m.moneda)}</span>
                      <span className={styles.lineaDocs}>
                        {f.documentos} {f.documentos === 1 ? 'documento' : 'documentos'}
                        {f.sinImporte > 0 ? ` · ${f.sinImporte} sin importe` : ''}
                      </span>
                    </dd>
                  ))}
                </dl>
              ))}
            </div>
            <p className={styles.aclaracion}>
              Los importes no se suman entre monedas: cada una va por su lado y no se convierte nada. Los totales los calcula el
              servidor sobre todos los documentos, no sobre los que muestra la tabla.
            </p>
          </>
        )}
      </DocSection>

      <DocSection title="Últimos doce meses">
        <GraficoDoceMeses filas={ficha.data?.meses ?? []} cargando={ficha.isPending} />
      </DocSection>

      <DocSection
        title="Documentos"
        actions={
          <span className={styles.atajos}>
            {(['cotizacion', 'pedido', 'entrega'] as const).map((tipo) =>
              porTipo[tipo] > 0 ? (
                <Link key={tipo} className={styles.atajo} to={`${RUTA[tipo]}?cliente=${clienteId}`}>
                  Ver {porTipo[tipo]} {porTipo[tipo] === 1 ? ETIQUETA[tipo].toLowerCase() : PLURAL[tipo]} en Ventas
                  <Icon name="arrow-right" size={16} />
                </Link>
              ) : null,
            )}
          </span>
        }
      >
        <div className={tabla.contenedor}>
          <table className={tabla.tabla}>
            <thead>
              <tr>
                <th scope="col">Documento</th>
                <th scope="col">Número</th>
                <th scope="col">Fecha</th>
                <th scope="col">Estado</th>
                <th scope="col" className={tabla.num}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {documentos.map((d) => (
                <tr key={`${d.tipo}-${d.id}`}>
                  <td className={tabla.nowrap}>{ETIQUETA[d.tipo]}</td>
                  <td className={tabla.nowrap}>
                    <Link className={tabla.enlace} to={`${RUTA[d.tipo]}/${d.id}`}>
                      {d.numero}
                    </Link>
                  </td>
                  <td className={tabla.nowrap}>{formatearFecha(d.fecha)}</td>
                  <td>
                    <Badge tone="neutral">{etiquetaDeEstado(d.tipo, d.estado)}</Badge>
                  </td>
                  <td className={tabla.num}>{formatearImporte(d.total, d.moneda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Paginador
          pagina={pagina}
          porPagina={porPagina}
          total={total}
          cargando={recargando}
          sustantivo={DOCUMENTO}
          onIr={onPagina}
          onTamano={onTamano}
        />
      </DocSection>

      {candidatosDeOc.length > 0 ? (
        <DocSection title={`Órdenes de compra detectadas (${candidatosDeOc.length})`}>
          <p className={styles.aclaracion}>
            Números de orden de compra que la migración encontró escritos en los documentos de este
            cliente. Ninguna orden se crea sola a partir de ellos.
          </p>
          <ul className={styles.candidatos}>
            {candidatosDeOc.map((c) => (
              <li key={c.id}>
                <Icon name="paperclip" size={16} />
                <span className={styles.candidato}>{c.archivo ?? '—'}</span>
                <span className={styles.lineaDocs}>
                  {c.estado ?? 'Sin estado'} · {formatearFecha(c.detectadoEn)}
                </span>
              </li>
            ))}
          </ul>
        </DocSection>
      ) : null}
    </div>
  )
}
