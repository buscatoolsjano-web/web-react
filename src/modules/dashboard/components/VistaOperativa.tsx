import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LinkButton } from '@/components/ui/LinkButton'
import { Skeleton } from '@/components/ui/Skeleton'
import { contar } from '@/components/tables/rango'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useBandeja, useCuentas } from '@/modules/emails/hooks/useEmails'
import { puedeUsarEmails } from '@/modules/emails/lib/permisos'
import { FILTROS_INICIALES as FILTROS_EMAILS } from '@/modules/emails/types'
import { useActividad, usePipeline } from '@/modules/informes/hooks/useActividad'
import { ErrorInforme } from '@/modules/informes/services/actividad'
import { puedeVerConfiguracion } from '@/modules/configuracion/lib/permisos'
import { useOrdenes } from '@/modules/mantenimiento/hooks/useOrdenes'
import { permisosDe as permisosMantenimiento } from '@/modules/mantenimiento/lib/permisos'
import { FILTROS_ORDENES_INICIALES } from '@/modules/mantenimiento/types'
import { useAutoridadNumeracion } from '@/modules/ventas/hooks/useAutoridadNumeracion'
import type { DocTypeVentas } from '@/modules/ventas/lib/autoridad'
import {
  ETIQUETA_TIPO,
  actividadDelMes,
  cotizacionesAbiertas,
  pedidosPendientes,
  revisionDelMes,
  textoAutoridadStel,
} from '../lib/inicio'
import { ListaMonedas, TarjetaMetrica } from './TarjetaMetrica'
import styles from './Inicio.module.css'

// Mismas claves de filtro que los listados: la caché se comparte con ellos.
const ORDENES_ABIERTAS = { ...FILTROS_ORDENES_INICIALES, estado: 'open', porPagina: 10 }
const EMAILS_PENDIENTES = { ...FILTROS_EMAILS, estado: 'pendiente' as const, porPagina: 1 }
const TIPOS_STEL: readonly DocTypeVentas[] = ['quote', 'sales_order', 'delivery']

/**
 * Inicio de admin y employee: el estado de HOY de la operación.
 *
 * Fuentes (todas ya existentes, sin consultas nuevas):
 *   · `informe_pipeline_comercial`: cotizaciones abiertas y pedidos pendientes
 *     por moneda — la misma RPC y la misma caché que Informes;
 *   · `informe_actividad_comercial`: lo emitido en el mes y lo marcado para
 *     revisar;
 *   · el listado de órdenes de Mantenimiento filtrado por «abierta»;
 *   · la bandeja de Emails filtrada por «pendiente» (sólo con cuenta);
 *   · la autoridad de numeración de Ventas (STEL).
 */
export function VistaOperativa() {
  const { activa } = useEmpresa()
  const rol = activa?.rol ?? null
  const idActividad = useId()

  const pipeline = usePipeline(null)
  const actividad = useActividad(null)
  const ordenes = useOrdenes(ORDENES_ABIERTAS)
  const cuentas = useCuentas()
  const bandeja = useBandeja(EMAILS_PENDIENTES)
  const autoridad = useAutoridadNumeracion()

  const verMantenimiento = permisosMantenimiento(activa).ver
  const verEmails = puedeUsarEmails(rol) && (cuentas.data?.length ?? 0) > 0

  const abiertas = pipeline.data ? cotizacionesAbiertas(pipeline.data) : null
  const pendientes = pipeline.data ? pedidosPendientes(pipeline.data) : null
  const delMes = actividad.data ? actividadDelMes(actividad.data) : null
  const revision = actividad.data ? revisionDelMes(actividad.data) : null
  const tiposStel = autoridad.cargando ? [] : TIPOS_STEL.filter((t) => autoridad.stel(t))

  const cargandoAlgo = pipeline.isPending || actividad.isPending || (verMantenimiento && ordenes.isPending) || cuentas.isPending
  // «Empresa sin actividad»: todo leyó bien y todo está en cero. Recién ahí se
  // reemplazan las tarjetas por un mensaje; nunca 4 ceros seguidos.
  const sinActividad =
    !cargandoAlgo &&
    !pipeline.error &&
    !actividad.error &&
    !ordenes.error &&
    abiertas?.documentos === 0 &&
    pendientes?.documentos === 0 &&
    (delMes ?? []).every((t) => t.documentos === 0) &&
    (!verMantenimiento || (ordenes.data?.total ?? 0) === 0) &&
    (!verEmails || (bandeja.data?.total ?? 0) === 0)

  return (
    <>
      {tiposStel.length > 0 ? (
        <Alert
          tone="warning"
          title={`STEL numera ${textoAutoridadStel(tiposStel)}`}
          action={
            puedeVerConfiguracion(rol) ? (
              <LinkButton to="/configuracion/numeracion" variant="secondary" size="sm">
                Ver numeración
              </LinkButton>
            ) : undefined
          }
        >
          <p>La emisión desde el ERP está bloqueada para esos documentos hasta completar la migración. Se pueden consultar y editar borradores.</p>
        </Alert>
      ) : null}

      {revision && revision.enRevision > 0 ? (
        <Alert
          tone="info"
          // Fase 19 · E4: cuenta lo que REQUIERE ATENCIÓN HOY, no lo que la
          // migración marcó. Son cosas distintas —del mes, 49 contra 45— y el
          // título tiene que decir la que se está contando.
          title={`${contar(revision.enRevision, { singular: 'documento del mes requiere', plural: 'documentos del mes requieren' })} atención`}
          action={
            <LinkButton to="/informes" variant="secondary" size="sm">
              Ver informe
            </LinkButton>
          }
        >
          <p>
            {revision.sinMoneda > 0
              ? `${revision.sinMoneda} ${revision.sinMoneda === 1 ? 'no tiene' : 'no tienen'} moneda: sus importes se muestran aparte, sin asignarles una.`
              : 'Vienen de la migración con algo que todavía se verifica en el documento.'}
          </p>
        </Alert>
      ) : null}

      {sinActividad ? (
        <EmptyState
          icon="inbox"
          title="Aún no hay actividad registrada"
          description="Cuando haya cotizaciones, pedidos, órdenes de servicio o correos pendientes, se van a ver acá. Mientras tanto, empezá desde los accesos rápidos."
        />
      ) : (
        <>
          <section className={styles.seccion} aria-label="Pendientes de hoy">
            <div className={styles.metricas}>
              <TarjetaMetrica
                titulo="Cotizaciones abiertas"
                icono="cart"
                valor={abiertas?.documentos ?? null}
                unidad={abiertas ? (abiertas.documentos === 1 ? 'cotización' : 'cotizaciones') : undefined}
                cargando={pipeline.isPending}
                error={!!pipeline.error}
                onReintentar={() => void pipeline.refetch()}
                enlace={{ to: '/ventas/cotizaciones', label: 'Ver cotizaciones' }}
              >
                <p className={styles.metricaNota}>Enviadas o aceptadas, sin pedido.</p>
                <ListaMonedas filas={abiertas?.porMoneda ?? []} etiqueta="Importe abierto por moneda" />
              </TarjetaMetrica>

              <TarjetaMetrica
                titulo="Pedidos por entregar"
                icono="truck"
                valor={pendientes?.documentos ?? null}
                unidad={pendientes ? (pendientes.documentos === 1 ? 'pedido' : 'pedidos') : undefined}
                cargando={pipeline.isPending}
                error={!!pipeline.error}
                onReintentar={() => void pipeline.refetch()}
                enlace={{ to: '/ventas/pedidos', label: 'Ver pedidos' }}
              >
                <p className={styles.metricaNota}>Sin entregar o con entrega parcial.</p>
                <ListaMonedas filas={pendientes?.porMoneda ?? []} etiqueta="Importe pendiente por moneda" />
              </TarjetaMetrica>

              {verMantenimiento ? (
                <TarjetaMetrica
                  titulo="Órdenes de servicio abiertas"
                  icono="wrench"
                  valor={ordenes.data?.total ?? null}
                  unidad={ordenes.data ? (ordenes.data.total === 1 ? 'orden' : 'órdenes') : undefined}
                  cargando={ordenes.isPending}
                  error={!!ordenes.error}
                  onReintentar={() => void ordenes.refetch()}
                  enlace={{ to: '/mantenimiento/ordenes?estado=open', label: 'Ver órdenes' }}
                />
              ) : null}

              {verEmails ? (
                <TarjetaMetrica
                  titulo="Emails pendientes"
                  icono="mail"
                  valor={bandeja.data?.total ?? null}
                  unidad={bandeja.data ? (bandeja.data.total === 1 ? 'hilo' : 'hilos') : undefined}
                  cargando={bandeja.isPending}
                  error={!!bandeja.error}
                  onReintentar={() => void bandeja.refetch()}
                  enlace={{ to: '/emails?estado=pendiente', label: 'Ver bandeja' }}
                >
                  {bandeja.data && bandeja.data.totalSinLeer > 0 ? <p className={styles.metricaNota}>{contar(bandeja.data.totalSinLeer, { singular: 'sin leer', plural: 'sin leer' })}</p> : null}
                </TarjetaMetrica>
              ) : null}
            </div>
          </section>

          <section className={styles.seccion} aria-labelledby={idActividad}>
            <div className={styles.seccionCabecera}>
              <h2 id={idActividad} className={styles.seccionTitulo}>
                Emitido este mes
              </h2>
              <Link to="/informes" className={styles.enlaceSeccion}>
                Ver informe completo
              </Link>
            </div>
            {actividad.isPending ? (
              <div className={styles.actividad}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className={styles.actividadTipo}>
                    <Skeleton width="50%" />
                    <Skeleton width="30%" height="1.5rem" />
                  </div>
                ))}
              </div>
            ) : actividad.error ? (
              <ErrorState
                compact
                title={actividad.error instanceof ErrorInforme ? actividad.error.message : 'No se pudo leer la actividad del mes.'}
                onRetry={actividad.error instanceof ErrorInforme && actividad.error.codigo !== 'desconocido' ? undefined : () => void actividad.refetch()}
                retrying={actividad.isFetching}
              />
            ) : (
              <ul className={styles.actividad}>
                {(delMes ?? []).map((t) => (
                  <li key={t.tipo} className={styles.actividadTipo}>
                    <span className={styles.actividadNombre}>{ETIQUETA_TIPO[t.tipo].plural[0]!.toUpperCase() + ETIQUETA_TIPO[t.tipo].plural.slice(1)}</span>
                    <span className={styles.actividadValor}>{contar(t.documentos, ETIQUETA_TIPO[t.tipo])}</span>
                    <ListaMonedas filas={t.porMoneda} etiqueta={`Importe de ${ETIQUETA_TIPO[t.tipo].plural} por moneda`} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  )
}
