import { Link } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { Icon } from '@/components/icons/Icon'
import { SkeletonRows } from '@/components/ui/Skeleton'
import tabla from '@/components/tables/Tabla.module.css'
import { formatearFecha } from '../lib/formato'
import { etiquetaDeServicio } from '../lib/estados'
import { ChipEspera, ChipEstadoOrden, ChipEtapa } from './ChipEstado'
import type { OrdenDeOrdenes, OrdenListado } from '../types'
import styles from './Listado.module.css'

export interface ListadoOrdenesProps {
  filas: readonly OrdenListado[]
  orden: OrdenDeOrdenes
  direccion: 'asc' | 'desc'
  /** Sin esto las columnas no ordenan: es el caso de la ficha del equipo,
   *  donde el listado es una sublista corta y un encabezado que parece un
   *  botón pero no hace nada es peor que uno que no lo parece. */
  onOrdenar?: (orden: OrdenDeOrdenes) => void
  cargando: boolean
}

const COLUMNAS: { clave: OrdenDeOrdenes; etiqueta: string; clase?: string | undefined }[] = [
  { clave: 'numero', etiqueta: 'Número' },
  { clave: 'fecha', etiqueta: 'Ingreso', clase: styles.ocultaBajo1024 },
  { clave: 'cliente', etiqueta: 'Cliente' },
  { clave: 'etapa', etiqueta: 'Etapa' },
]

/**
 * El listado de órdenes de servicio.
 *
 * El cliente que se muestra es **el de la orden**, no el dueño actual del
 * equipo. Son dos cosas distintas: si la herramienta se vendió después, la
 * orden sigue diciendo a quién se le hizo el trabajo. Por eso el enlace del
 * cliente sale de `customer_id` de la orden.
 *
 * No hay columna de total. Cada orden cotiza en SU moneda —`quote_currency_code`
 * es por orden—, así que una columna de totales en un listado mezclado pondría
 * pesos y dólares uno debajo del otro como si fueran comparables. El total se
 * ve en la ficha, donde la moneda está al lado.
 *
 * Fase 13 · E5: tabla y tarjetas comunes; el vacío y el error los resuelve la
 * página (o la ficha del equipo, que muestra su propio mensaje).
 */
export function ListadoOrdenes({
  filas,
  orden,
  direccion,
  onOrdenar = undefined,
  cargando,
}: ListadoOrdenesProps) {
  const isMobile = useIsMobile()

  if (cargando && filas.length === 0) {
    return (
      <div className={tabla.contenedor}>
        <SkeletonRows rows={5} columns={isMobile ? 2 : 6} label="Cargando órdenes…" />
      </div>
    )
  }
  if (filas.length === 0) return null

  if (isMobile) {
    return (
      <ul className={tabla.tarjetas}>
        {filas.map((o) => (
          <li key={o.id}>
            <Link to={`/mantenimiento/ordenes/${o.id}`} className={tabla.tarjeta}>
              <span className={tabla.tarjetaTitulo}>{o.numero}</span>
              <span className={`${tabla.tarjetaDerecha} ${tabla.tarjetaMeta}`}>{formatearFecha(o.fechaIngreso)}</span>
              <span className={tabla.tarjetaTexto}>{o.cliente}</span>
              <span className={`${tabla.tarjetaTexto} ${tabla.tarjetaMeta}`}>
                {o.activoReferencia}
                {o.activoSerie ? ` · ${o.activoSerie}` : ''}
                {' · '}
                {o.tecnico ?? 'sin técnico asignado'}
              </span>
              <span className={`${tabla.tarjetaTexto} ${tabla.estados}`}>
                <ChipEstadoOrden estado={o.estado} />
                <ChipEtapa estado={o.etapa} />
                <ChipEspera enEspera={o.enEspera} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className={tabla.contenedor}>
      <table className={tabla.tabla}>
        <thead>
          <tr>
            {COLUMNAS.map((c) => {
              const activa = orden === c.clave
              return (
                <th
                  key={c.clave}
                  scope="col"
                  className={c.clase}
                  aria-sort={!onOrdenar ? undefined : activa ? (direccion === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  {onOrdenar ? (
                    <button type="button" className={tabla.orden} onClick={() => onOrdenar(c.clave)}>
                      {c.etiqueta}
                      {activa ? <Icon name={direccion === 'asc' ? 'arrow-up' : 'arrow-down'} size={16} className={tabla.ordenIcono} /> : null}
                    </button>
                  ) : (
                    c.etiqueta
                  )}
                </th>
              )
            })}
            <th scope="col">Equipo</th>
            <th scope="col" className={styles.ocultaBajo1280}>
              Servicio
            </th>
            <th scope="col" className={styles.ocultaBajo1280}>
              Técnico
            </th>
            <th scope="col">Estado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((o) => (
            <tr key={o.id}>
              <td className={tabla.nowrap}>
                <Link to={`/mantenimiento/ordenes/${o.id}`} className={tabla.enlace}>
                  {o.numero}
                </Link>
              </td>
              <td className={`${tabla.nowrap} ${styles.ocultaBajo1024}`}>{formatearFecha(o.fechaIngreso)}</td>
              <td className={styles.recorta} title={o.cliente}>
                <Link to={`/clientes/${o.clienteId}`} className={tabla.enlaceSuave}>
                  {o.cliente}
                </Link>
              </td>
              <td>
                <ChipEtapa estado={o.etapa} />
              </td>
              <td className={styles.recorta}>
                <Link to={`/mantenimiento/activos/${o.activoId}`} className={tabla.enlaceSuave}>
                  {o.activoReferencia}
                </Link>
              </td>
              <td className={`${styles.recorta} ${styles.ocultaBajo1280}`}>{etiquetaDeServicio(o.tipoServicio)}</td>
              <td
                className={`${o.tecnico ? styles.recorta : styles.falta} ${styles.ocultaBajo1280}`}
                title={o.tecnico ?? undefined}
              >
                {o.tecnico ?? 'sin asignar'}
              </td>
              <td>
                <span className={tabla.estados}>
                  <ChipEstadoOrden estado={o.estado} />
                  <ChipEspera enEspera={o.enEspera} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
