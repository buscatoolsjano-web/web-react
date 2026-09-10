import { Link } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { presentarCumplimiento, presentarEstado } from '../lib/estados'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { ChipEstado } from './ChipEstado'
import { RUTA_DE, type DireccionOrden, type DocumentoListado, type OrdenVentas } from '../types'
import styles from './ListadoDocumentos.module.css'

export interface ListadoDocumentosProps {
  filas: readonly DocumentoListado[]
  orden: OrdenVentas
  direccion: DireccionOrden
  onOrdenar: (orden: OrdenVentas) => void
  /** Etiqueta de la columna «Origen». Sin origen posible, no se muestra. */
  etiquetaOrigen: string | null
  cargando: boolean
  /** Ids seleccionados. Sin `onSeleccionar` no se muestran las casillas. */
  seleccionados?: ReadonlySet<string>
  onSeleccionar?: (id: string, marcado: boolean) => void
  onSeleccionarTodos?: (marcado: boolean) => void
}

const COLUMNAS: { clave: OrdenVentas; etiqueta: string }[] = [
  { clave: 'numero', etiqueta: 'Número' },
  { clave: 'cliente', etiqueta: 'Cliente' },
  { clave: 'fecha', etiqueta: 'Fecha' },
  { clave: 'total', etiqueta: 'Total' },
]

function flecha(activa: boolean, direccion: DireccionOrden): string {
  if (!activa) return ''
  return direccion === 'asc' ? ' ↑' : ' ↓'
}

/**
 * El mismo listado para los tres documentos.
 *
 * En el legacy también era el mismo, sólo que copiado y pegado tres veces
 * (`renderCotList`, `renderPedidos`, `renderNotasEntrega`), con las tres
 * copias divergiendo de a poco.
 *
 * Tabla en desktop y tarjetas en mobile: una tabla de siete columnas en 390px
 * obliga a hacer scroll horizontal en toda la página, que es justo lo que no
 * queremos.
 */
export function ListadoDocumentos({
  filas,
  orden,
  direccion,
  onOrdenar,
  etiquetaOrigen,
  cargando,
  seleccionados,
  onSeleccionar,
  onSeleccionarTodos,
}: ListadoDocumentosProps) {
  const isMobile = useIsMobile()
  const haySeleccion = onSeleccionar !== undefined && seleccionados !== undefined
  const todosMarcados = haySeleccion && filas.length > 0 && filas.every((d) => seleccionados.has(d.id))

  if (!cargando && filas.length === 0) {
    return (
      <p className={styles.vacio}>
        No hay documentos que coincidan con estos filtros.
      </p>
    )
  }

  if (isMobile) {
    return (
      <ul className={styles.tarjetas}>
        {filas.map((d) => (
          <li key={d.id}>
            <Link to={`${RUTA_DE[d.tipo]}/${d.id}`} className={styles.tarjeta}>
              <span className={styles.tarjetaNumero}>{d.numero}</span>
              <ChipEstado estado={presentarEstado(d.tipo, d.estado)} />
              <span className={styles.tarjetaCliente}>{d.clienteNombre}</span>
              <span className={styles.tarjetaFecha}>{formatearFecha(d.fecha)}</span>
              <span className={styles.tarjetaTotal}>{formatearImporte(d.total, d.moneda)}</span>
              {d.necesitaRevision ? (
                <span className={styles.marca} title={d.motivosRevision.join(', ')}>
                  ⚠ {d.motivosRevision.length} observación
                  {d.motivosRevision.length === 1 ? '' : 'es'}
                </span>
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
            {haySeleccion ? (
              <th scope="col" className={styles.check}>
                <input
                  type="checkbox"
                  checked={todosMarcados}
                  aria-label="Seleccionar todos los de esta página"
                  onChange={(e) => onSeleccionarTodos?.(e.target.checked)}
                />
              </th>
            ) : null}
            {COLUMNAS.map((c) => (
              <th
                key={c.clave}
                scope="col"
                className={c.clave === 'total' ? styles.derecha : undefined}
                aria-sort={
                  orden === c.clave
                    ? direccion === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <button type="button" className={styles.thBoton} onClick={() => onOrdenar(c.clave)}>
                  {c.etiqueta}
                  {flecha(orden === c.clave, direccion)}
                </button>
              </th>
            ))}
            <th scope="col">Título</th>
            <th scope="col">Estado</th>
            {etiquetaOrigen ? <th scope="col">{etiquetaOrigen}</th> : null}
            <th scope="col">Vendedor</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((d) => (
            <tr key={d.id}>
              {haySeleccion ? (
                <td className={styles.check}>
                  <input
                    type="checkbox"
                    checked={seleccionados.has(d.id)}
                    aria-label={`Seleccionar ${d.numero}`}
                    onChange={(e) => onSeleccionar(d.id, e.target.checked)}
                  />
                </td>
              ) : null}
              <td>
                <Link to={`${RUTA_DE[d.tipo]}/${d.id}`} className={styles.enlace}>
                  {d.numero}
                </Link>
                {d.necesitaRevision ? (
                  <span
                    className={styles.aviso}
                    title={d.motivosRevision.join(', ')}
                    aria-label={`${d.motivosRevision.length} observaciones`}
                  >
                    ⚠
                  </span>
                ) : null}
              </td>
              <td>{d.clienteNombre}</td>
              <td className={styles.nowrap}>{formatearFecha(d.fecha)}</td>
              <td className={styles.derecha}>{formatearImporte(d.total, d.moneda)}</td>
              <td className={styles.titulo}>{d.titulo ?? '—'}</td>
              <td className={styles.nowrap}>
                <ChipEstado estado={presentarEstado(d.tipo, d.estado)} />
                {d.estadoSecundario ? (
                  <>
                    {' '}
                    <ChipEstado estado={presentarCumplimiento(d.estadoSecundario)} />
                  </>
                ) : null}
              </td>
              {etiquetaOrigen ? <td className={styles.nowrap}>{d.origen ?? '—'}</td> : null}
              <td className={styles.nowrap}>{d.vendedor ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
