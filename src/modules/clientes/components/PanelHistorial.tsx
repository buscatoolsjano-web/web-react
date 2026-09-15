import { Link } from 'react-router-dom'
import { DocSection } from '@/components/document/DocSection'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import tabla from '@/components/tables/Tabla.module.css'
import { GraficoActividad } from './GraficoActividad'
import { useActividadMensual, useTotalesPorMoneda } from '../hooks/useResumen'
import { etiquetaDeEstado } from '../lib/estados'
import { formatearFecha, formatearImporte } from '../lib/formato'
import type { DocumentoDeCliente, TipoDeDocumento } from '../types'
import styles from './PanelHistorial.module.css'

export interface PanelHistorialProps {
  clienteId: string
  documentos: readonly DocumentoDeCliente[]
  cargando: boolean
}

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
export function PanelHistorial({ clienteId, documentos, cargando }: PanelHistorialProps) {
  const totales = useTotalesPorMoneda(clienteId)
  const actividad = useActividadMensual(clienteId, 12)

  const porTipo = {
    cotizacion: documentos.filter((d) => d.tipo === 'cotizacion').length,
    pedido: documentos.filter((d) => d.tipo === 'pedido').length,
    entrega: documentos.filter((d) => d.tipo === 'entrega').length,
  }

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

  if (documentos.length === 0) {
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
        <GraficoActividad filas={actividad.data ?? []} cargando={actividad.isPending} />
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
      </DocSection>
    </div>
  )
}
