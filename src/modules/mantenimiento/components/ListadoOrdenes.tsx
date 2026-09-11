import { Link } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
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

const COLUMNAS: { clave: OrdenDeOrdenes; etiqueta: string }[] = [
  { clave: 'numero', etiqueta: 'Número' },
  { clave: 'fecha', etiqueta: 'Ingreso' },
  { clave: 'cliente', etiqueta: 'Cliente' },
  { clave: 'etapa', etiqueta: 'Etapa' },
]

function flecha(activa: boolean, direccion: 'asc' | 'desc'): string {
  if (!activa) return ''
  return direccion === 'asc' ? ' ↑' : ' ↓'
}

/**
 * El listado de órdenes de servicio.
 *
 * El cliente que se muestra es **el de la orden**, no el dueño actual del
 * equipo. Son dos cosas distintas: si la herramienta se vendió después, la
 * orden sigue diciendo a quién se le hizo el trabajo. Por eso el enlace del
 * cliente sale de `customer_id` de la orden.
 *
 * No hay columna de total: el presupuesto es de la entrega 3 y en v1 todas las
 * órdenes valen cero. Mostrar una columna de ceros sería ruido.
 */
export function ListadoOrdenes({
  filas,
  orden,
  direccion,
  onOrdenar = undefined,
  cargando,
}: ListadoOrdenesProps) {
  const isMobile = useIsMobile()

  if (!cargando && filas.length === 0) {
    return <p className={styles.vacio}>No hay órdenes que coincidan con estos filtros.</p>
  }

  if (isMobile) {
    return (
      <ul className={styles.tarjetas}>
        {filas.map((o) => (
          <li key={o.id}>
            <Link to={`/mantenimiento/ordenes/${o.id}`} className={styles.tarjeta}>
              <span className={styles.tarjetaNumero}>{o.numero}</span>
              <span className={styles.tarjetaFecha}>{formatearFecha(o.fechaIngreso)}</span>
              <span className={styles.tarjetaProveedor}>{o.cliente}</span>
              <span className={styles.tarjetaDato}>
                {o.activoReferencia}
                {o.activoSerie ? ` · ${o.activoSerie}` : ''}
              </span>
              <span className={o.tecnico ? styles.tarjetaDato : styles.tarjetaFalta}>
                {o.tecnico ?? 'sin técnico asignado'}
              </span>
              <span className={styles.tarjetaChips}>
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
    <div className={styles.scroll}>
      <table className={styles.tabla}>
        <thead>
          <tr>
            {COLUMNAS.map((c) => (
              <th
                key={c.clave}
                scope="col"
                aria-sort={
                  !onOrdenar ? undefined
                  : orden === c.clave ? (direccion === 'asc' ? 'ascending' : 'descending')
                  : 'none'
                }
              >
                {onOrdenar ? (
                  <button
                    type="button"
                    className={styles.thBoton}
                    onClick={() => onOrdenar(c.clave)}
                  >
                    {c.etiqueta}
                    {flecha(orden === c.clave, direccion)}
                  </button>
                ) : (
                  c.etiqueta
                )}
              </th>
            ))}
            <th scope="col">Equipo</th>
            <th scope="col">Servicio</th>
            <th scope="col">Técnico</th>
            <th scope="col">Estado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((o) => (
            <tr key={o.id}>
              <td className={styles.numero}>
                <Link to={`/mantenimiento/ordenes/${o.id}`} className={styles.enlace}>
                  {o.numero}
                </Link>
              </td>
              <td className={styles.numero}>{formatearFecha(o.fechaIngreso)}</td>
              <td className={styles.recorta} title={o.cliente}>
                <Link to={`/clientes/${o.clienteId}`} className={styles.enlaceSuave}>
                  {o.cliente}
                </Link>
              </td>
              <td>
                <ChipEtapa estado={o.etapa} />
              </td>
              <td className={styles.recorta}>
                <Link to={`/mantenimiento/activos/${o.activoId}`} className={styles.enlaceSuave}>
                  {o.activoReferencia}
                </Link>
              </td>
              <td className={styles.recorta}>{etiquetaDeServicio(o.tipoServicio)}</td>
              <td
                className={o.tecnico ? styles.recorta : styles.falta}
                title={o.tecnico ?? undefined}
              >
                {o.tecnico ?? 'sin asignar'}
              </td>
              <td className={styles.tarjetaChips}>
                <ChipEstadoOrden estado={o.estado} />
                <ChipEspera enEspera={o.enEspera} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
