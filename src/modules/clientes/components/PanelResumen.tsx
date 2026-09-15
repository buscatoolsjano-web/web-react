import { useResumenCliente } from '../hooks/useResumen'
import { Alert } from '@/components/feedback/Alert'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { formatearFecha } from '../lib/formato'
import styles from './PanelResumen.module.css'

export interface PanelResumenProps {
  clienteId: string
}

/**
 * El panel rápido, arriba de las pestañas (Fase 13 · E4: dentro de la sección
 * «Actividad»; la ayuda de cada métrica va como title y también para lectores
 * de pantalla, que un title solo no alcanza).
 *
 * En el legacy se abría desde el listado (`abrirClienteQuickPanel`); acá vive
 * en la ficha, que es donde se termina mirando al cliente. Son los mismos
 * números **menos uno**: el importe único que sumaba ARS, USD y EUR. Los
 * importes están en Historial, separados por moneda.
 *
 * Nada de lo que se muestra acá se calcula en el navegador: es una sola
 * función SQL.
 */
export function PanelResumen({ clienteId }: PanelResumenProps) {
  const { data, isPending, error } = useResumenCliente(clienteId)

  if (error) {
    return (
      <Alert tone="danger" role="alert" title="No se pudo leer el resumen">
        <p>{error.message}</p>
      </Alert>
    )
  }

  if (isPending) return <SkeletonRows rows={2} columns={3} label="Cargando el resumen…" />
  if (!data) return null

  const metricas: { etiqueta: string; valor: string; ayuda?: string }[] = [
    { etiqueta: 'Cotizaciones', valor: String(data.cotizaciones) },
    { etiqueta: 'Pedidos', valor: String(data.pedidos) },
    { etiqueta: 'Entregas', valor: String(data.entregas) },
    {
      etiqueta: 'Última actividad',
      valor: formatearFecha(data.ultimaActividad),
      ayuda: 'El documento más reciente, de cualquier tipo',
    },
    {
      etiqueta: 'Productos distintos',
      valor: String(data.productosDistintos),
      ayuda: 'Cotizados o pedidos alguna vez',
    },
    {
      etiqueta: 'Documentos 12 meses',
      valor: String(data.documentos12m),
      ayuda: 'Cotizaciones, pedidos y entregas del último año',
    },
  ]

  return (
    <dl className={styles.tira}>
      {metricas.map((m) => (
        <div key={m.etiqueta} className={styles.metrica} title={m.ayuda}>
          <dt className={styles.etiqueta}>{m.etiqueta}</dt>
          <dd className={styles.valor}>
            {m.valor}
            {m.ayuda ? <span className="sr-only">. {m.ayuda}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}
