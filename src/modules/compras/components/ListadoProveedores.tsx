import { Link } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { etiquetaDeEstado, nombreDePais, nombreVisible } from '../lib/formato'
import type { DireccionOrden, OrdenProveedores, ProveedorListado } from '../types'
import styles from './ListadoProveedores.module.css'

export interface ListadoProveedoresProps {
  filas: readonly ProveedorListado[]
  orden: OrdenProveedores
  direccion: DireccionOrden
  onOrdenar: (orden: OrdenProveedores) => void
  cargando: boolean
  seleccionados: ReadonlySet<string>
  onSeleccionar: (id: string, marcado: boolean) => void
  onSeleccionarTodos: (marcado: boolean) => void
}

const COLUMNAS: { clave: OrdenProveedores; etiqueta: string }[] = [
  { clave: 'referencia', etiqueta: 'Referencia' },
  { clave: 'nombre', etiqueta: 'Razón social' },
  { clave: 'pais', etiqueta: 'País' },
  { clave: 'formaPago', etiqueta: 'Forma de pago' },
]

function flecha(activa: boolean, direccion: DireccionOrden): string {
  if (!activa) return ''
  return direccion === 'asc' ? ' ↑' : ' ↓'
}

/**
 * El listado del maestro de proveedores.
 *
 * Tabla en escritorio y tarjetas en mobile: siete columnas en 390px obligan a
 * hacer scroll horizontal de toda la página, que es justo lo que no se
 * quiere. La tabla, además, scrollea dentro de su propia caja.
 */
export function ListadoProveedores({
  filas,
  orden,
  direccion,
  onOrdenar,
  cargando,
  seleccionados,
  onSeleccionar,
  onSeleccionarTodos,
}: ListadoProveedoresProps) {
  const isMobile = useIsMobile()
  const todosMarcados = filas.length > 0 && filas.every((p) => seleccionados.has(p.id))

  if (!cargando && filas.length === 0) {
    return <p className={styles.vacio}>No hay proveedores que coincidan con estos filtros.</p>
  }

  if (isMobile) {
    return (
      <ul className={styles.tarjetas}>
        {filas.map((p) => (
          <li key={p.id}>
            <Link to={`/compras/proveedores/${p.id}`} className={styles.tarjeta}>
              <span className={styles.tarjetaNombre}>
                {nombreVisible(p.razonSocial, p.nombreComercial)}
              </span>
              {p.referencia ? <span className={styles.tarjetaRef}>{p.referencia}</span> : null}
              {p.nombreComercial ? (
                <span className={styles.tarjetaDato}>{p.razonSocial}</span>
              ) : null}
              <span className={styles.tarjetaDato}>
                {nombreDePais(p.pais)}
                {p.telefono ? ` · ${p.telefono}` : ''}
              </span>
              {p.email ? <span className={styles.tarjetaDato}>{p.email}</span> : null}
              {p.formaPago ? <span className={styles.tarjetaDato}>{p.formaPago}</span> : null}
              {p.necesitaRevision ? (
                <span className={styles.marca} title={p.motivosRevision.join(', ')}>
                  ⚠ {p.motivosRevision.length} observación
                  {p.motivosRevision.length === 1 ? '' : 'es'}
                </span>
              ) : null}
              {p.dadoDeBaja || p.estado !== 'active' ? (
                <span className={styles.baja}>{etiquetaDeEstado(p.estado, p.dadoDeBaja)}</span>
              ) : null}
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
            <th scope="col">Nombre comercial</th>
            <th scope="col">Teléfono</th>
            <th scope="col">Email</th>
            <th scope="col">Estado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((p) => (
            <tr key={p.id} className={p.dadoDeBaja ? styles.filaBaja : undefined}>
              <td className={styles.check}>
                <input
                  type="checkbox"
                  checked={seleccionados.has(p.id)}
                  aria-label={`Seleccionar ${p.razonSocial}`}
                  onChange={(e) => onSeleccionar(p.id, e.target.checked)}
                />
              </td>
              <td className={styles.referencia}>{p.referencia ?? '—'}</td>
              <td>
                <Link to={`/compras/proveedores/${p.id}`} className={styles.enlace}>
                  {p.razonSocial}
                </Link>
                {p.necesitaRevision ? (
                  <span className={styles.marca} title={p.motivosRevision.join(', ')}>
                    {' '}
                    ⚠
                  </span>
                ) : null}
              </td>
              <td className={styles.pais} title={p.pais ?? undefined}>
                {nombreDePais(p.pais)}
              </td>
              <td className={styles.recorta} title={p.formaPago ?? undefined}>
                {p.formaPago ?? '—'}
              </td>
              <td className={styles.recorta} title={p.nombreComercial ?? undefined}>
                {p.nombreComercial ?? '—'}
              </td>
              <td className={styles.referencia}>{p.telefono ?? '—'}</td>
              <td className={styles.recorta} title={p.email ?? undefined}>
                {p.email ?? '—'}
              </td>
              <td className={p.dadoDeBaja ? styles.baja : undefined}>
                {etiquetaDeEstado(p.estado, p.dadoDeBaja)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
