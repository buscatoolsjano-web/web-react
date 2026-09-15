import { Icon } from '@/components/icons/Icon'
import { Link } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { cx } from '@/utils/cx'
import {
  ETIQUETA_NOMBRE_COMERCIAL,
  etiquetaDeEstado,
  nombreDePais,
  nombreVisible,
} from '../lib/formato'
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

/** `secundaria`: la columna se oculta por debajo de ese ancho y su dato pasa
 *  abajo de la razón social (ver `.soloCompacta` y `.soloAngosta`). */
const COLUMNAS: { clave: OrdenProveedores; etiqueta: string; secundaria?: 'lg' }[] = [
  { clave: 'referencia', etiqueta: 'Referencia' },
  { clave: 'nombre', etiqueta: 'Razón social' },
  { clave: 'pais', etiqueta: 'País', secundaria: 'lg' },
  { clave: 'formaPago', etiqueta: 'Forma de pago', secundaria: 'lg' },
]

function flecha(activa: boolean, direccion: DireccionOrden) {
  if (!activa) return null
  return <Icon name={direccion === 'asc' ? 'arrow-up' : 'arrow-down'} size={16} className={styles.flecha} />
}

/**
 * El listado del maestro de proveedores.
 *
 * Tabla en escritorio y tarjetas en mobile: siete columnas en 390px obligan a
 * hacer scroll horizontal de toda la página, que es justo lo que no se
 * quiere. La tabla, además, scrollea dentro de su propia caja.
 *
 * Fase 14 · E0: prioridad de columnas. Por debajo de 1280px (1440 con el
 * tamaño «Grande») nombre comercial, teléfono y email; por debajo de 1024px
 * (1152) también país y forma de pago. Lo oculto se lee abajo de la razón
 * social, así que a 1024 y 768 la tabla entra sin scroll interno.
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
              <span className={styles.tarjetaNombre}>{nombreVisible(p.razonSocial)}</span>
              {p.referencia ? <span className={styles.tarjetaRef}>{p.referencia}</span> : null}
              {/* El «nombre comercial» del legacy es casi siempre una persona
                  de contacto. Va abajo y etiquetado, nunca como título. */}
              {p.nombreComercial ? (
                <span className={styles.tarjetaDato}>
                  {ETIQUETA_NOMBRE_COMERCIAL}: {p.nombreComercial}
                </span>
              ) : null}
              <span className={styles.tarjetaDato}>
                {nombreDePais(p.pais)}
                {p.telefono ? ` · ${p.telefono}` : ''}
              </span>
              {p.email ? <span className={styles.tarjetaDato}>{p.email}</span> : null}
              {p.formaPago ? <span className={styles.tarjetaDato}>{p.formaPago}</span> : null}
              {p.necesitaRevision ? (
                <span className={styles.marca} title={p.motivosRevision.join(', ')}>
                  <Icon name="alert-triangle" size={16} /> {p.motivosRevision.length} observación
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
                className={c.secundaria === 'lg' ? styles.ocultaBajoLg : undefined}
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
            <th scope="col" className={styles.ocultaBajoXl}>{ETIQUETA_NOMBRE_COMERCIAL}</th>
            <th scope="col" className={styles.ocultaBajoXl}>Teléfono</th>
            <th scope="col" className={styles.ocultaBajoXl}>Email</th>
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
                    <Icon name="alert-triangle" size={16} role="img" aria-hidden={false} aria-label="A revisar" />
                  </span>
                ) : null}
                <span className={cx(styles.dato, styles.soloAngosta)}>
                  {nombreDePais(p.pais)}
                  {p.formaPago ? ` · ${p.formaPago}` : ''}
                </span>
                {p.nombreComercial ? (
                  <span className={cx(styles.dato, styles.soloCompacta)}>
                    {ETIQUETA_NOMBRE_COMERCIAL}: {p.nombreComercial}
                  </span>
                ) : null}
                {p.telefono || p.email ? (
                  <span className={cx(styles.dato, styles.soloCompacta)}>
                    {[p.telefono, p.email].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </td>
              <td className={cx(styles.pais, styles.ocultaBajoLg)} title={p.pais ?? undefined}>
                {nombreDePais(p.pais)}
              </td>
              <td className={cx(styles.recorta, styles.ocultaBajoLg)} title={p.formaPago ?? undefined}>
                {p.formaPago ?? '—'}
              </td>
              <td className={cx(styles.recorta, styles.ocultaBajoXl)} title={p.nombreComercial ?? undefined}>
                {p.nombreComercial ?? '—'}
              </td>
              <td className={cx(styles.referencia, styles.ocultaBajoXl)}>{p.telefono ?? '—'}</td>
              <td className={cx(styles.recorta, styles.ocultaBajoXl)} title={p.email ?? undefined}>
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
