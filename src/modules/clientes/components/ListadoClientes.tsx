import { Link } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { Badge } from '@/components/ui/Badge'
import { Icon } from '@/components/icons/Icon'
import { SkeletonRows } from '@/components/ui/Skeleton'
import tabla from '@/components/tables/Tabla.module.css'
import { formatearCuit, nombreVisible } from '../lib/formato'
import type { ClienteListado, DireccionOrden, OrdenClientes } from '../types'
import styles from './ListadoClientes.module.css'

export interface ListadoClientesProps {
  filas: readonly ClienteListado[]
  orden: OrdenClientes
  direccion: DireccionOrden
  onOrdenar: (orden: OrdenClientes) => void
  cargando: boolean
  seleccionados: ReadonlySet<string>
  onSeleccionar: (id: string, marcado: boolean) => void
  onSeleccionarTodos: (marcado: boolean) => void
}

const COLUMNAS: { clave: OrdenClientes; etiqueta: string }[] = [
  { clave: 'referencia', etiqueta: 'Referencia' },
  { clave: 'nombre', etiqueta: 'Nombre jurídico' },
  { clave: 'cuit', etiqueta: 'CUIT' },
  { clave: 'rubro', etiqueta: 'Rubro' },
]

/** Los emails de un cliente son varios; en la tabla entra el primero. */
function resumenEmails(emails: readonly string[]): { texto: string; resto: number } {
  if (emails.length === 0) return { texto: '—', resto: 0 }
  return { texto: emails[0]!, resto: emails.length - 1 }
}

const observaciones = (n: number) => `${n} ${n === 1 ? 'observación' : 'observaciones'}`

/**
 * El listado del maestro.
 *
 * Tabla en desktop y tarjetas en mobile: la tabla del legacy tiene ocho
 * columnas y en 390px obliga a hacer scroll horizontal de toda la página.
 * Hasta 1279 px (con la barra lateral, ~720 px útiles a 1024) el nombre
 * comercial pasa debajo de la razón social y el dominio deja de ser columna
 * (se ve en la ficha); hasta 1023 px el rubro también pasa debajo del nombre.
 * El vacío y el error los resuelve la página.
 */
export function ListadoClientes({
  filas,
  orden,
  direccion,
  onOrdenar,
  cargando,
  seleccionados,
  onSeleccionar,
  onSeleccionarTodos,
}: ListadoClientesProps) {
  const isMobile = useIsMobile()
  const todosMarcados = filas.length > 0 && filas.every((c) => seleccionados.has(c.id))

  if (cargando && filas.length === 0) {
    return (
      <div className={tabla.contenedor}>
        <SkeletonRows rows={6} columns={isMobile ? 2 : 6} label="Cargando clientes…" />
      </div>
    )
  }
  if (filas.length === 0) return null

  if (isMobile) {
    return (
      <ul className={tabla.tarjetas}>
        {filas.map((c) => {
          const emails = resumenEmails(c.emails)
          return (
            <li key={c.id}>
              <Link to={`/clientes/${c.id}`} className={tabla.tarjeta}>
                <span className={tabla.tarjetaTitulo}>{nombreVisible(c.razonSocial, c.nombreComercial)}</span>
                <span className={tabla.tarjetaDerecha}>
                  {c.referencia ? <span className={styles.referencia}>{c.referencia}</span> : null}
                </span>
                {c.nombreComercial ? <span className={tabla.tarjetaTexto}>{c.razonSocial}</span> : null}
                <span className={tabla.tarjetaMeta}>
                  {formatearCuit(c.cuit)}
                  {c.rubro ? ` · ${c.rubro}` : ''}
                </span>
                <span className={`${tabla.tarjetaMeta} ${styles.email}`}>
                  {emails.texto}
                  {emails.resto > 0 ? ` +${emails.resto}` : ''}
                </span>
                {c.necesitaRevision || c.dadoDeBaja ? (
                  <span className={styles.estadosTarjeta}>
                    {c.necesitaRevision ? (
                      <Badge tone="warning" dot>
                        {observaciones(c.motivosRevision.length)}
                      </Badge>
                    ) : null}
                    {c.dadoDeBaja ? (
                      <Badge tone="danger" outline>
                        Dado de baja
                      </Badge>
                    ) : null}
                  </span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className={tabla.contenedor}>
      <table className={tabla.tabla}>
        <thead>
          <tr>
            <th scope="col" className={tabla.check}>
              <input
                type="checkbox"
                checked={todosMarcados}
                aria-label="Seleccionar todos los de esta página"
                onChange={(e) => onSeleccionarTodos(e.target.checked)}
              />
            </th>
            {COLUMNAS.map((c) => {
              const activa = orden === c.clave
              return (
                <th
                  key={c.clave}
                  scope="col"
                  className={c.clave === 'rubro' ? styles.soloMedio : undefined}
                  aria-sort={activa ? (direccion === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" className={tabla.orden} onClick={() => onOrdenar(c.clave)}>
                    {c.etiqueta}
                    {activa ? <Icon name={direccion === 'asc' ? 'arrow-up' : 'arrow-down'} size={16} className={tabla.ordenIcono} /> : null}
                  </button>
                </th>
              )
            })}
            <th scope="col" className={styles.soloAncho}>
              Nombre
            </th>
            <th scope="col">Email</th>
            <th scope="col" className={styles.soloAncho}>
              Dominio
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((c) => {
            const emails = resumenEmails(c.emails)
            return (
              <tr key={c.id} className={seleccionados.has(c.id) ? tabla.seleccionada : undefined}>
                <td className={tabla.check}>
                  <input
                    type="checkbox"
                    checked={seleccionados.has(c.id)}
                    aria-label={`Seleccionar ${c.razonSocial}`}
                    onChange={(e) => onSeleccionar(c.id, e.target.checked)}
                  />
                </td>
                <td className={`${tabla.nowrap} ${tabla.secundario}`}>{c.referencia ?? '—'}</td>
                <td className={styles.colNombre}>
                  <Link to={`/clientes/${c.id}`} className={c.dadoDeBaja ? `${tabla.enlace} ${styles.baja}` : tabla.enlace}>
                    {c.razonSocial}
                  </Link>
                  {c.nombreComercial ? <span className={styles.soloTablet}>{c.nombreComercial}</span> : null}
                  {c.rubro ? <span className={styles.soloCompacto}>{c.rubro}</span> : null}
                  {c.necesitaRevision || c.dadoDeBaja ? (
                    <span className={styles.estados}>
                      {c.necesitaRevision ? (
                        <Badge tone="warning" dot>
                          <span title={c.motivosRevision.join(', ')}>{observaciones(c.motivosRevision.length)}</span>
                        </Badge>
                      ) : null}
                      {c.dadoDeBaja ? (
                        <Badge tone="danger" outline>
                          Dado de baja
                        </Badge>
                      ) : null}
                    </span>
                  ) : null}
                </td>
                <td className={`${tabla.nowrap} ${styles.cuit}`}>{formatearCuit(c.cuit)}</td>
                <td className={styles.soloMedio}>{c.rubro ?? <span className={tabla.secundario}>—</span>}</td>
                <td className={`${tabla.textoCorto} ${styles.soloAncho}`}>{c.nombreComercial ?? <span className={tabla.secundario}>—</span>}</td>
                <td className={styles.recorte} title={c.emails.join(', ')}>
                  {emails.texto}
                  {emails.resto > 0 ? <span className={tabla.secundario}> +{emails.resto}</span> : null}
                </td>
                <td className={`${styles.recorte} ${styles.soloAncho}`} title={c.dominios.join(', ')}>
                  {c.dominios[0] ?? <span className={tabla.secundario}>—</span>}
                  {c.dominios.length > 1 ? <span className={tabla.secundario}> +{c.dominios.length - 1}</span> : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
