import { Link } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { Icon } from '@/components/icons/Icon'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { contar } from '@/components/tables/rango'
import tabla from '@/components/tables/Tabla.module.css'
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

const COLUMNAS: { clave: OrdenActivos; etiqueta: string; clase?: string | undefined }[] = [
  { clave: 'referencia', etiqueta: 'Referencia' },
  { clave: 'serie', etiqueta: 'Nº de serie' },
  { clave: 'modelo', etiqueta: 'Modelo', clase: styles.ocultaBajo1024 },
  { clave: 'cliente', etiqueta: 'Dueño actual' },
  { clave: 'alta', etiqueta: 'Alta', clase: styles.ocultaBajo1280 },
]

const ORDENES = { singular: 'orden', plural: 'órdenes' }

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
 *
 * Fase 13 · E5: tabla y tarjetas comunes; el vacío y el error, en la página.
 */
export function ListadoActivos({
  filas,
  orden,
  direccion,
  onOrdenar,
  cargando,
}: ListadoActivosProps) {
  const isMobile = useIsMobile()

  if (cargando && filas.length === 0) {
    return (
      <div className={tabla.contenedor}>
        <SkeletonRows rows={5} columns={isMobile ? 2 : 6} label="Cargando equipos…" />
      </div>
    )
  }
  if (filas.length === 0) return null

  if (isMobile) {
    return (
      <ul className={tabla.tarjetas}>
        {filas.map((a) => (
          <li key={a.id}>
            <Link to={`/mantenimiento/activos/${a.id}`} className={tabla.tarjeta}>
              <span className={tabla.tarjetaTitulo}>{a.referencia}</span>
              <span className={`${tabla.tarjetaDerecha} ${tabla.tarjetaMeta}`}>{a.serie ?? 'sin número de serie'}</span>
              <span className={tabla.tarjetaTexto}>{a.modelo ?? a.tipo ?? '—'}</span>
              <span className={`${tabla.tarjetaTexto} ${tabla.tarjetaMeta}`}>
                {a.dueno ?? 'sin dueño asignado'}
                {' · '}
                {a.ordenes === 0 ? 'sin órdenes' : contar(a.ordenes, ORDENES)}
              </span>
              {a.dadoDeBaja ? (
                <span className={`${tabla.tarjetaTexto} ${tabla.estados}`}>
                  <ChipBaja dadoDeBaja={a.dadoDeBaja} />
                </span>
              ) : null}
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
                  aria-sort={activa ? (direccion === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" className={tabla.orden} onClick={() => onOrdenar(c.clave)}>
                    {c.etiqueta}
                    {activa ? <Icon name={direccion === 'asc' ? 'arrow-up' : 'arrow-down'} size={16} className={tabla.ordenIcono} /> : null}
                  </button>
                </th>
              )
            })}
            <th scope="col" className={styles.ocultaBajo1280}>
              Tipo
            </th>
            <th scope="col" className={tabla.num}>
              Órdenes
            </th>
            <th scope="col">Estado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((a) => (
            <tr key={a.id}>
              <td className={tabla.nowrap}>
                <Link to={`/mantenimiento/activos/${a.id}`} className={tabla.enlace}>
                  {a.referencia}
                </Link>
              </td>
              <td className={a.serie ? tabla.nowrap : styles.falta}>{a.serie ?? 'sin número de serie'}</td>
              <td className={`${styles.recorta} ${styles.ocultaBajo1024}`} title={a.modelo ?? undefined}>
                {a.modelo ?? '—'}
              </td>
              <td className={a.dueno ? styles.recorta : styles.falta} title={a.dueno ?? undefined}>
                {a.dueno ? (
                  <Link to={`/clientes/${a.duenoId}`} className={tabla.enlaceSuave}>
                    {a.dueno}
                  </Link>
                ) : (
                  'sin dueño asignado'
                )}
              </td>
              <td className={`${tabla.nowrap} ${styles.ocultaBajo1280}`}>{formatearFecha(a.creadoEn)}</td>
              <td className={`${styles.recorta} ${styles.ocultaBajo1280}`}>{a.tipo ?? '—'}</td>
              <td className={tabla.num}>{a.ordenes}</td>
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
