import { useId } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Badge } from '@/components/ui/Badge'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useDocumentos } from '@/modules/ventas/hooks/useDocumentos'
import { formatearFecha, formatearImporte } from '@/modules/ventas/lib/formato'
import { FILTROS_INICIALES as FILTROS_VENTAS } from '@/modules/ventas/types'
import { TarjetaMetrica } from './TarjetaMetrica'
import styles from './Inicio.module.css'

// Mismos filtros que el listado de cotizaciones: la caché se comparte con él.
const PENDIENTES = { ...FILTROS_VENTAS, estado: 'sent', porPagina: 5 }
const BORRADORES = { ...FILTROS_VENTAS, estado: 'draft', porPagina: 5 }

/**
 * Inicio del vendedor: sus cotizaciones. Es el mismo listado de Ventas con el
 * filtro de estado (RLS ya limita qué documentos ve cada vendedor); no hay
 * métricas de toda la empresa porque el vendedor no tiene Informes.
 */
export function VistaVentas() {
  const idRecientes = useId()
  const pendientes = useDocumentos('cotizacion', PENDIENTES)
  const borradores = useDocumentos('cotizacion', BORRADORES)

  const sinActividad = !pendientes.isPending && !borradores.isPending && !pendientes.error && !borradores.error && pendientes.data?.total === 0 && borradores.data?.total === 0

  if (sinActividad) {
    return (
      <EmptyState
        icon="inbox"
        title="Aún no hay actividad registrada"
        description="Cuando tengas cotizaciones pendientes o borradores, se van a ver acá. Mientras tanto, empezá desde los accesos rápidos."
      />
    )
  }

  const filas = pendientes.data?.filas ?? []
  return (
    <>
      <section className={styles.seccion} aria-label="Tus cotizaciones">
        <div className={styles.metricas}>
          <TarjetaMetrica
            titulo="Cotizaciones pendientes"
            icono="cart"
            valor={pendientes.data?.total ?? null}
            unidad={pendientes.data ? (pendientes.data.total === 1 ? 'cotización' : 'cotizaciones') : undefined}
            cargando={pendientes.isPending}
            error={!!pendientes.error}
            onReintentar={() => void pendientes.refetch()}
            enlace={{ to: '/ventas/cotizaciones?estado=sent', label: 'Ver pendientes' }}
          >
            <p className={styles.metricaNota}>Enviadas al cliente, esperando respuesta.</p>
          </TarjetaMetrica>
          <TarjetaMetrica
            titulo="Borradores"
            icono="edit"
            valor={borradores.data?.total ?? null}
            unidad={borradores.data ? (borradores.data.total === 1 ? 'borrador' : 'borradores') : undefined}
            cargando={borradores.isPending}
            error={!!borradores.error}
            onReintentar={() => void borradores.refetch()}
            enlace={{ to: '/ventas/cotizaciones?estado=draft', label: 'Ver borradores' }}
          >
            <p className={styles.metricaNota}>Todavía no se enviaron.</p>
          </TarjetaMetrica>
        </div>
      </section>

      <section className={styles.seccion} aria-labelledby={idRecientes}>
        <div className={styles.seccionCabecera}>
          <h2 id={idRecientes} className={styles.seccionTitulo}>
            Pendientes más recientes
          </h2>
          <Link to="/ventas/cotizaciones?estado=sent" className={styles.enlaceSeccion}>
            Ver todas
          </Link>
        </div>
        {pendientes.isPending ? (
          <SkeletonRows rows={3} columns={3} label="Cargando cotizaciones pendientes…" />
        ) : pendientes.error ? (
          <ErrorState compact title="No se pudieron leer las cotizaciones pendientes." onRetry={() => void pendientes.refetch()} retrying={pendientes.isFetching} />
        ) : filas.length === 0 ? (
          <p className={styles.nota}>No tenés cotizaciones pendientes.</p>
        ) : (
          <ul className={styles.recientes}>
            {filas.map((d) => (
              <li key={d.id}>
                <Link to={`/ventas/cotizaciones/${d.id}`} className={styles.reciente}>
                  <span className={styles.recienteNumero}>{d.numero}</span>
                  <span className={styles.recienteCliente}>{d.clienteNombre}</span>
                  <span className={styles.recienteMeta}>
                    {formatearFecha(d.fecha)}
                    {d.necesitaRevision ? (
                      <Badge tone="warning" dot>
                        A revisar
                      </Badge>
                    ) : null}
                  </span>
                  <span className={styles.recienteImporte}>{formatearImporte(d.total, d.moneda)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
