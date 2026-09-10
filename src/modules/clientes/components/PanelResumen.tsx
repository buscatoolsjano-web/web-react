import { useResumenCliente } from '../hooks/useResumen'
import { formatearFecha } from '../lib/formato'
import styles from './PanelResumen.module.css'

export interface PanelResumenProps {
  clienteId: string
}

/**
 * El panel rápido, arriba de las pestañas.
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
      <p className={styles.error} role="alert">
        No se pudo leer el resumen: {error.message}
      </p>
    )
  }

  if (isPending) return <p className={styles.nota}>Cargando el resumen…</p>
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
          <dd className={styles.valor}>{m.valor}</dd>
        </div>
      ))}
    </dl>
  )
}
