import { Link } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
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

function flecha(activa: boolean, direccion: DireccionOrden): string {
  if (!activa) return ''
  return direccion === 'asc' ? ' ↑' : ' ↓'
}

/** Los emails de un cliente son varios; en la tabla entra el primero. */
function resumenEmails(emails: readonly string[]): { texto: string; resto: number } {
  if (emails.length === 0) return { texto: '—', resto: 0 }
  return { texto: emails[0]!, resto: emails.length - 1 }
}

/**
 * El listado del maestro.
 *
 * Tabla en desktop y tarjetas en mobile: la tabla del legacy tiene ocho
 * columnas y en 390px obliga a hacer scroll horizontal de toda la página.
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

  if (!cargando && filas.length === 0) {
    return <p className={styles.vacio}>No hay clientes que coincidan con estos filtros.</p>
  }

  if (isMobile) {
    return (
      <ul className={styles.tarjetas}>
        {filas.map((c) => {
          const emails = resumenEmails(c.emails)
          return (
            <li key={c.id}>
              <Link to={`/clientes/${c.id}`} className={styles.tarjeta}>
                <span className={styles.tarjetaNombre}>
                  {nombreVisible(c.razonSocial, c.nombreComercial)}
                </span>
                {c.referencia ? (
                  <span className={styles.tarjetaRef}>{c.referencia}</span>
                ) : null}
                <span className={styles.tarjetaDato}>{formatearCuit(c.cuit)}</span>
                <span className={styles.tarjetaDato}>
                  {emails.texto}
                  {emails.resto > 0 ? ` +${emails.resto}` : ''}
                </span>
                {c.rubro ? <span className={styles.tarjetaDato}>{c.rubro}</span> : null}
                {c.necesitaRevision ? (
                  <span className={styles.marca} title={c.motivosRevision.join(', ')}>
                    ⚠ {c.motivosRevision.length} observación
                    {c.motivosRevision.length === 1 ? '' : 'es'}
                  </span>
                ) : null}
                {c.dadoDeBaja ? <span className={styles.baja}>Dado de baja</span> : null}
              </Link>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className={styles.scroll}>
      <table className={styles.tabla}>
        <thead>
          <tr>
            <th scope="col" className={styles.check}>
              <input
                type="checkbox"
                checked={todosMarcados}
                aria-label="Seleccionar todos los de esta página"
                onChange={(e) => onSeleccionarTodos(e.target.checked)}
              />
            </th>
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
            <th scope="col">Nombre</th>
            <th scope="col">Email</th>
            <th scope="col">Dominio</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((c) => {
            const emails = resumenEmails(c.emails)
            return (
              <tr key={c.id} className={c.dadoDeBaja ? styles.filaBaja : undefined}>
                <td className={styles.check}>
                  <input
                    type="checkbox"
                    checked={seleccionados.has(c.id)}
                    aria-label={`Seleccionar ${c.razonSocial}`}
                    onChange={(e) => onSeleccionar(c.id, e.target.checked)}
                  />
                </td>
                <td className={styles.referencia}>{c.referencia ?? '—'}</td>
                <td>
                  <Link to={`/clientes/${c.id}`} className={styles.enlace}>
                    {c.razonSocial}
                  </Link>
                  {c.necesitaRevision ? (
                    <span className={styles.marca} title={c.motivosRevision.join(', ')}>
                      {' '}
                      ⚠
                    </span>
                  ) : null}
                  {c.dadoDeBaja ? <span className={styles.baja}> · dado de baja</span> : null}
                </td>
                <td className={styles.mono}>{formatearCuit(c.cuit)}</td>
                <td>{c.rubro ?? '—'}</td>
                <td>{c.nombreComercial ?? '—'}</td>
                <td className={styles.emails} title={c.emails.join(', ')}>
                  {emails.texto}
                  {emails.resto > 0 ? <span className={styles.resto}> +{emails.resto}</span> : null}
                </td>
                <td className={styles.emails} title={c.dominios.join(', ')}>
                  {c.dominios[0] ?? '—'}
                  {c.dominios.length > 1 ? (
                    <span className={styles.resto}> +{c.dominios.length - 1}</span>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
