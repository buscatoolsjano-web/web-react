import { Link } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { formatearFecha } from '../lib/formato'
import { ChipBaja } from './ChipEstado'
import type { ActivoListado, OrdenActivos } from '../types'
import styles from './Listado.module.css'

export interface ListadoActivosProps {
  filas: readonly ActivoListado[]
  orden: OrdenActivos
  direccion: 'asc' | 'desc'
  onOrdenar: (orden: OrdenActivos) => void
  cargando: boolean
}

const COLUMNAS: { clave: OrdenActivos; etiqueta: string }[] = [
  { clave: 'referencia', etiqueta: 'Referencia' },
  { clave: 'serie', etiqueta: 'Nº de serie' },
  { clave: 'modelo', etiqueta: 'Modelo' },
  { clave: 'cliente', etiqueta: 'Dueño actual' },
  { clave: 'alta', etiqueta: 'Alta' },
]

function flecha(activa: boolean, direccion: 'asc' | 'desc'): string {
  if (!activa) return ''
  return direccion === 'asc' ? ' ↑' : ' ↓'
}

/**
 * El listado de equipos.
 *
 * El enlace va **por la referencia**, no por el serial: la identidad del
 * equipo es su uuid y la referencia es el nombre legible que la representa.
 * El serial se muestra porque es con lo que alguien busca una herramienta en
 * el mostrador, pero puede faltar y puede repetirse, así que no titula nada.
 *
 * «Sin serie» y «sin dueño» no son huecos: son estados legítimos y se dicen
 * con palabras. Un equipo puede entrar al taller antes de saber de quién es.
 */
export function ListadoActivos({
  filas,
  orden,
  direccion,
  onOrdenar,
  cargando,
}: ListadoActivosProps) {
  const isMobile = useIsMobile()

  if (!cargando && filas.length === 0) {
    return <p className={styles.vacio}>No hay equipos que coincidan con estos filtros.</p>
  }

  if (isMobile) {
    return (
      <ul className={styles.tarjetas}>
        {filas.map((a) => (
          <li key={a.id}>
            <Link to={`/mantenimiento/activos/${a.id}`} className={styles.tarjeta}>
              <span className={styles.tarjetaNumero}>{a.referencia}</span>
              <span className={a.serie ? styles.tarjetaFecha : styles.tarjetaFalta}>
                {a.serie ?? 'sin número de serie'}
              </span>
              <span className={styles.tarjetaProveedor}>{a.modelo ?? a.tipo ?? '—'}</span>
              <span className={a.dueno ? styles.tarjetaDato : styles.tarjetaFalta}>
                {a.dueno ?? 'sin dueño asignado'}
              </span>
              <span className={styles.tarjetaDato}>
                {a.ordenes === 0
                  ? 'sin órdenes'
                  : `${a.ordenes} ${a.ordenes === 1 ? 'orden' : 'órdenes'}`}
              </span>
              <span className={styles.tarjetaChips}>
                <ChipBaja dadoDeBaja={a.dadoDeBaja} />
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
                  orden === c.clave ? (direccion === 'asc' ? 'ascending' : 'descending') : 'none'
                }
              >
                <button type="button" className={styles.thBoton} onClick={() => onOrdenar(c.clave)}>
                  {c.etiqueta}
                  {flecha(orden === c.clave, direccion)}
                </button>
              </th>
            ))}
            <th scope="col">Tipo</th>
            <th scope="col" className={styles.derecha}>
              Órdenes
            </th>
            <th scope="col">Estado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((a) => (
            <tr key={a.id}>
              <td className={styles.numero}>
                <Link to={`/mantenimiento/activos/${a.id}`} className={styles.enlace}>
                  {a.referencia}
                </Link>
              </td>
              <td className={a.serie ? styles.numero : styles.falta}>
                {a.serie ?? 'sin número de serie'}
              </td>
              <td className={styles.recorta} title={a.modelo ?? undefined}>
                {a.modelo ?? '—'}
              </td>
              <td className={a.dueno ? styles.recorta : styles.falta} title={a.dueno ?? undefined}>
                {a.dueno ? (
                  <Link to={`/clientes/${a.duenoId}`} className={styles.enlaceSuave}>
                    {a.dueno}
                  </Link>
                ) : (
                  'sin dueño asignado'
                )}
              </td>
              <td className={styles.numero}>{formatearFecha(a.creadoEn)}</td>
              <td className={styles.recorta}>{a.tipo ?? '—'}</td>
              <td className={styles.derecha}>{a.ordenes}</td>
              <td>
                <ChipBaja dadoDeBaja={a.dadoDeBaja} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
