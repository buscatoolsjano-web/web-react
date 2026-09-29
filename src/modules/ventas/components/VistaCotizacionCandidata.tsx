import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/icons/Icon'
import { formatearImporte } from '../lib/formato'
import { lineasDeCotizacion } from '../services/importarOc'
import styles from './VistaCotizacionCandidata.module.css'

export interface VistaCotizacionCandidataProps {
  quoteId: string
  moneda: string
  /** Los productos que pide la OC, para marcar cuáles ya estaban cotizados. */
  productosDeLaOc: readonly string[]
}

/**
 * Mirar una cotización candidata sin salir del modal (Fase 30 · E6).
 *
 * «2 de 5 coinciden» no alcanza para decidir si es LA cotización: pueden ser
 * dos productos que ese cliente compra siempre y aparecen en todas las que se
 * le mandaron. Lo que resuelve la duda es ver QUÉ tiene adentro.
 *
 * Cada línea dice si el cliente la está pidiendo en esta orden o no. Eso
 * convierte la decisión en una comparación, que es lo que hace alguien con el
 * papel al lado.
 */
export function VistaCotizacionCandidata({
  quoteId,
  moneda,
  productosDeLaOc,
}: VistaCotizacionCandidataProps) {
  const lineas = useQuery({
    queryKey: ['ventas', 'oc', 'lineas-cotizacion', quoteId],
    queryFn: () => lineasDeCotizacion(quoteId),
    staleTime: 5 * 60_000,
  })

  if (lineas.isPending) return <p className={styles.nota}>Abriendo la cotización…</p>
  if (lineas.error) {
    return (
      <p className={styles.nota} role="alert">
        {lineas.error.message}
      </p>
    )
  }

  const pedidos = new Set(productosDeLaOc)
  const filas = lineas.data ?? []
  if (filas.length === 0) return <p className={styles.nota}>Esta cotización no tiene líneas.</p>

  return (
    <ul className={styles.lineas}>
      {filas.map((l) => {
        const enLaOc = l.productId !== null && pedidos.has(l.productId)
        return (
          <li key={l.id} className={enLaOc ? `${styles.linea} ${styles.coincide}` : styles.linea}>
            <span className={styles.marca} aria-hidden="true">
              {enLaOc ? <Icon name="check" size={16} /> : null}
            </span>
            <span className={styles.sku}>{l.sku ?? '—'}</span>
            <span className={styles.nombre}>{l.nombre ?? ''}</span>
            <span className={styles.cantidad}>
              {l.cantidad} × {formatearImporte(l.precio, moneda)}
            </span>
            {/* El texto va para el lector de pantalla: el tilde solo no se
                anuncia, y es justamente el dato que se está comparando. */}
            <span className="sr-only">{enLaOc ? 'La orden pide este producto' : 'No está en la orden'}</span>
          </li>
        )
      })}
    </ul>
  )
}
