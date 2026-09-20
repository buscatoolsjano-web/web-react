import { Alert } from '@/components/feedback/Alert'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useCliente360 } from '../hooks/useCliente360'
import { nombreDelMes } from '../lib/kpis'
import { formatearFecha } from '../lib/formato'
import { KpisComerciales } from './KpisComerciales'
import styles from './PanelResumen.module.css'

export interface PanelResumenProps {
  clienteId: string
}

/**
 * La sección «Actividad» de la ficha completa.
 *
 * Hasta la Fase 19 · E2 esto mostraba seis contadores —cotizaciones, pedidos,
 * entregas, última actividad, productos, documentos del año— y **ningún
 * importe**. La ficha rápida, a un click de distancia, sí los mostraba y
 * separados por moneda. Dos respuestas distintas a «cuánto compra este
 * cliente», en la misma pantalla.
 *
 * Ahora las dos leen `resumen_cliente_360` y comparten las tarjetas. De paso,
 * abrir la ficha pasó de tres consultas a una: los contadores, los importes por
 * moneda y la serie del gráfico venían en tres RPC distintas y ahora vienen
 * juntas.
 *
 * Los contadores del histórico se quedan: son la memoria larga del cliente y
 * contestan otra pregunta —«hace cuánto que trabajamos con éste»— que los KPI
 * del mes no contestan.
 */
export function PanelResumen({ clienteId }: PanelResumenProps) {
  const { data, isPending, error } = useCliente360(clienteId)

  if (error) {
    return (
      <Alert tone="danger" role="alert" title="No se pudo leer la actividad">
        <p>{error.message}</p>
      </Alert>
    )
  }

  if (isPending) return <SkeletonRows rows={3} columns={4} label="Cargando la actividad…" />
  if (!data) return null

  const { totales, kpis } = data

  const historico: { etiqueta: string; valor: string; ayuda?: string }[] = [
    { etiqueta: 'Cotizaciones', valor: String(totales.cotizaciones) },
    { etiqueta: 'Pedidos', valor: String(totales.pedidos) },
    { etiqueta: 'Entregas', valor: String(totales.entregas) },
    {
      etiqueta: 'Última actividad',
      valor: formatearFecha(totales.ultimaActividad),
      ayuda: 'El documento más reciente, de cualquier tipo',
    },
    {
      etiqueta: 'Productos distintos',
      valor: String(totales.productosDistintos),
      ayuda: 'Cotizados o pedidos alguna vez',
    },
    {
      etiqueta: 'Documentos 12 meses',
      valor: String(totales.documentos12m),
      ayuda: 'Cotizaciones, pedidos y entregas del último año',
    },
  ]

  return (
    <div className={styles.wrap}>
      <h4 className={styles.titulo}>En {nombreDelMes(kpis.mes)}</h4>
      <KpisComerciales valores={kpis.valores} mes={kpis.mes} />

      <h4 className={styles.titulo}>Histórico</h4>
      <dl className={styles.tira}>
        {historico.map((m) => (
          <div key={m.etiqueta} className={styles.metrica} title={m.ayuda}>
            <dt className={styles.etiqueta}>{m.etiqueta}</dt>
            <dd className={styles.valor}>
              {m.valor}
              {m.ayuda ? <span className="sr-only">. {m.ayuda}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
