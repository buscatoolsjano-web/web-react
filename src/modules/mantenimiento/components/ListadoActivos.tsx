import { Link } from 'react-router-dom'
import { LinkButton } from '@/components/ui/LinkButton'
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
  /** El equipo con la ficha rápida abierta. */
  abierto?: string | null
  /** Abrir la ficha rápida en vez de navegar a la ficha completa. */
  onAbrirFicha?: (id: string) => void
}

const COLUMNAS: { clave: OrdenActivos; etiqueta: string; clase?: string | undefined }[] = [
  { clave: 'referencia', etiqueta: 'Referencia' },
  { clave: 'serie', etiqueta: 'Nº de serie' },
  { clave: 'modelo', etiqueta: 'Marca y modelo', clase: styles.ocultaBajo1024 },
  { clave: 'cliente', etiqueta: 'Dueño actual' },
  { clave: 'alta', etiqueta: 'Alta', clase: styles.ocultaBajo1280 },
]

/**
 * Los controles que se manejan solos: un click acá adentro es del control.
 * El link de la referencia y el botón «Servicio» ya hacen lo suyo.
 */
const CONTROLES = 'a, button, input, select, textarea, label, [role="button"], [role="link"]'

/**
 * Fase 20 · E1: **la fila entera abre la ficha rápida.**
 *
 * En el taller se busca una herramienta y se la quiere ver, no apuntarle a un
 * link de 80 px. Los controles siguen siendo suyos y Ctrl+click sigue
 * abriendo la ficha completa en otra pestaña.
 */
function filaClickeable(onAbrir: ((id: string) => void) | undefined, id: string) {
  if (!onAbrir) return {}
  return {
    tabIndex: 0,
    onClick: (e: React.MouseEvent<HTMLTableRowElement>) => {
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      if ((e.target as HTMLElement).closest(CONTROLES)) return
      // Seleccionar un serial para copiarlo termina en un click sobre la fila.
      if ((window.getSelection()?.toString() ?? '') !== '') return
      e.currentTarget.focus()
      onAbrir(id)
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      if (e.target !== e.currentTarget) return
      e.preventDefault()
      onAbrir(id)
    },
  }
}

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
  abierto = null,
  onAbrirFicha,
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
            {/* En el taller la tarjeta es una ficha: se toca para ver el
                equipo y tiene «Servicio» a la vista, que es a lo que se viene.
                Por eso NO es un link envolviendo todo —un link no puede tener
                otro adentro— sino una caja con dos destinos claros. */}
            <div
              className={tabla.tarjeta}
              data-fila-activo={a.id}
              aria-current={a.id === abierto ? 'true' : undefined}
              {...filaClickeable(onAbrirFicha, a.id)}
            >
              <span className={tabla.tarjetaTitulo}>
                <Link to={`/mantenimiento/activos/${a.id}`} className={tabla.enlace}>
                  {a.referencia}
                </Link>
              </span>
              <span className={`${tabla.tarjetaDerecha} ${tabla.tarjetaMeta} ${styles.serieTarjeta}`}>
                {a.serie ?? 'sin número de serie'}
              </span>
              <span className={tabla.tarjetaTexto}>
                {[a.marca, a.modelo ?? a.tipo].filter(Boolean).join(' · ') || '—'}
              </span>
              <span className={`${tabla.tarjetaTexto} ${tabla.tarjetaMeta}`}>
                {a.dueno ?? 'sin dueño asignado'}
                {' · '}
                {a.ordenes === 0 ? 'sin órdenes' : contar(a.ordenes, ORDENES)}
              </span>
              <span className={`${tabla.tarjetaTexto} ${styles.accionTarjeta}`}>
                {a.dadoDeBaja ? <ChipBaja dadoDeBaja={a.dadoDeBaja} /> : <span />}
                <LinkButton to={`/mantenimiento/ordenes/nueva?activo=${a.id}`} variant="secondary">
                  Servicio
                </LinkButton>
              </span>
            </div>
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
            <th scope="col" className={`${tabla.num} ${styles.ocultaBajo1280Tambien}`}>
              Órdenes
            </th>
            <th scope="col" className={styles.ocultaBajo1280Tambien}>
              Estado
            </th>
            <th scope="col" className={styles.accion}>
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((a) => (
            <tr
              key={a.id}
              data-fila-activo={a.id}
              aria-current={a.id === abierto ? 'true' : undefined}
              className={[onAbrirFicha ? styles.fila : '', a.id === abierto ? styles.abierta : '']
                .filter(Boolean)
                .join(' ')}
              {...filaClickeable(onAbrirFicha, a.id)}
            >
              <td className={styles.colEquipo}>
                <Link to={`/mantenimiento/activos/${a.id}`} className={tabla.enlace}>
                  {a.referencia}
                </Link>
                {/* La etiqueta con la que el taller lo llama: «P037 - ASM10-9
                    PC». Sin ella la fila es una referencia y un serial. */}
                {a.identificador ? (
                  <span className={styles.etiqueta} title={a.identificador}>
                    {a.identificador}
                  </span>
                ) : null}
              </td>
              <td className={a.serie ? `${tabla.nowrap} ${styles.serieCelda}` : styles.falta}>{a.serie ?? 'sin número de serie'}</td>
              {/* Marca arriba, modelo abajo: la marca agrupa —FEIN son 204 de
                  los 358— y el modelo identifica. */}
              <td
                className={styles.ocultaBajo1024}
                title={[a.marca, a.modelo].filter(Boolean).join(' · ')}
              >
                {a.marca ? <span className={styles.marca}>{a.marca}</span> : null}
                <span className={styles.modelo}>{a.modelo ?? '—'}</span>
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
              <td className={`${tabla.num} ${styles.ocultaBajo1280Tambien}`}>{a.ordenes}</td>
              <td className={styles.ocultaBajo1280Tambien}>
                <ChipBaja dadoDeBaja={a.dadoDeBaja} />
              </td>
              {/* La acción del taller: abrir un servicio para este equipo. Es
                  la que el panel anterior tenía en cada fila, y la que hace
                  que el listado sirva para trabajar y no sólo para mirar. */}
              <td className={styles.accion}>
                <LinkButton
                  to={`/mantenimiento/ordenes/nueva?activo=${a.id}`}
                  variant="secondary"
                  size="sm"
                >
                  Servicio
                </LinkButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
