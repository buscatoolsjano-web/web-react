import { Alert } from '@/components/feedback/Alert'
import { Badge } from '@/components/ui/Badge'
import { LinkButton } from '@/components/ui/LinkButton'
import { Icon } from '@/components/icons/Icon'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useActivo } from '../hooks/useActivos'
import { permisosDe } from '../lib/permisos'
import { formatearFecha } from '../lib/formato'
import styles from './FichaRapidaActivo.module.css'

export interface FichaRapidaActivoProps {
  activoId: string
  tituloId?: string | undefined
}

/**
 * La ficha rápida de un equipo.
 *
 * Contesta lo que se pregunta en el mostrador cuando llega una herramienta:
 * **qué es, de quién es, qué número de serie tiene y cuántas veces volvió.**
 * Sin salir del listado, que es de donde se la abre.
 *
 * Lo que NO hace: inventar. Si no hay órdenes cargadas dice que no las hay en
 * vez de mostrar un cero que parezca un dato; si el equipo no tiene serie, lo
 * dice con palabras; y la procedencia —que vino de STEL— está, pero abajo y
 * en chico: al taller no le importa de qué sistema salió.
 */
export function FichaRapidaActivo({ activoId, tituloId }: FichaRapidaActivoProps) {
  const { data, isPending, error } = useActivo(activoId)
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)

  if (error) {
    return (
      <Alert tone="danger" role="alert" title="No se pudo leer el equipo">
        <p>{error.message}</p>
      </Alert>
    )
  }

  if (isPending) {
    return <SkeletonRows rows={5} columns={2} label="Cargando el equipo…" />
  }

  if (data === null) {
    return (
      <Alert tone="warning" title="No se puede ver este equipo">
        <p>No existe, o no está entre los equipos que podés ver.</p>
      </Alert>
    )
  }

  const equipo = data.identificador ?? data.modelo ?? data.referencia
  const marcaYModelo = [data.marca, data.modelo].filter(Boolean).join(' · ')

  return (
    <div className={styles.ficha}>
      <header className={styles.cabecera}>
        <p className={styles.referencia}>{data.referencia}</p>
        <h2 className={styles.nombre} id={tituloId}>
          {equipo}
        </h2>
        <p className={styles.marca}>{marcaYModelo || 'Sin marca ni modelo'}</p>
        <p className={styles.estados}>
          {data.dadoDeBaja ? (
            <Badge tone="danger" outline>
              Dado de baja
            </Badge>
          ) : null}
          {data.bajoContrato ? <Badge tone="success">Bajo contrato</Badge> : null}
          {data.ordenes === 0 && data.historial === 0 ? <Badge tone="neutral">Sin servicios</Badge> : null}
        </p>
      </header>

      <dl className={styles.datos}>
        <div>
          <dt>Cliente</dt>
          <dd>
            {data.dueno ?? <span className={styles.vacio}>Sin cliente vinculado</span>}
            {data.ciudad ? <span className={styles.ciudad}>{data.ciudad}</span> : null}
          </dd>
        </div>
        <div>
          <dt>N° de serie</dt>
          <dd className={styles.serie}>
            {data.serie ?? <span className={styles.vacio}>Sin número de serie</span>}
          </dd>
        </div>
        {/* Dos filas y no una: «Trabajo actual» son órdenes del ERP nuevo y
            «Historial STEL» es lo que se importó. Un servicio de 2024 no es
            trabajo de hoy, y un solo número los confundiría. */}
        <div>
          <dt>Trabajo actual</dt>
          <dd>
            {data.ordenes === 0 ? (
              <span className={styles.vacio}>Sin órdenes abiertas</span>
            ) : (
              `${data.ordenes} ${data.ordenes === 1 ? 'orden' : 'órdenes'}`
            )}
          </dd>
        </div>
        <div>
          <dt>Historial STEL</dt>
          <dd>
            {data.historial === 0 ? (
              <span className={styles.vacio}>Sin historial importado</span>
            ) : (
              <>
                {data.historial === 1 ? '1 servicio' : `${data.historial} servicios`}
                {data.historialUltimo ? (
                  <span className={styles.ciudad}>
                    último: {formatearFecha(data.historialUltimo.fecha)} · {data.historialUltimo.referencia}
                  </span>
                ) : null}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Garantía</dt>
          <dd>
            {data.garantiaDesde || data.garantiaHasta ? (
              `${formatearFecha(data.garantiaDesde)} → ${formatearFecha(data.garantiaHasta)}`
            ) : (
              <span className={styles.vacio}>Sin garantía cargada</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Alta en el ERP</dt>
          <dd>{formatearFecha(data.creadoEn)}</dd>
        </div>
        <div>
          <dt>Tipo</dt>
          <dd>{data.tipo ?? <span className={styles.vacio}>Sin tipo</span>}</dd>
        </div>
      </dl>

      {data.notas ? <p className={styles.notas}>{data.notas}</p> : null}

      {/* La procedencia existe pero no grita: al taller no le importa de qué
          sistema salió el equipo. Tiene que poder saberse, y nada más. */}
      {data.origen ? (
        <p className={styles.origen}>
          Origen: {data.origen.sistema.toUpperCase()} · {data.origen.idExterno}
          {data.origen.sincronizado
            ? ` · sincronizado ${formatearFecha(data.origen.sincronizado)}`
            : ''}
        </p>
      ) : null}

      <div className={styles.acciones}>
        <LinkButton to={`/mantenimiento/activos/${data.id}`} variant="primary">
          Abrir ficha
        </LinkButton>
        {data.historial > 0 ? (
          <LinkButton to={`/mantenimiento/activos/${data.id}?tab=servicios`} variant="secondary">
            Ver historial
          </LinkButton>
        ) : null}
        {permisos.crear ? (
          <LinkButton
            to={`/mantenimiento/ordenes/nueva?activo=${data.id}`}
            variant="secondary"
            icon={<Icon name="plus" size={16} />}
          >
            Nuevo servicio
          </LinkButton>
        ) : null}
      </div>
    </div>
  )
}
