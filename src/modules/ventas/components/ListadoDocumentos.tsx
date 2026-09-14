import { Link } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { Icon } from '@/components/icons/Icon'
import { SkeletonRows } from '@/components/ui/Skeleton'
import tabla from '@/components/tables/Tabla.module.css'
import { presentarCumplimiento, presentarEstado } from '../lib/estados'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { ChipEstado } from './ChipEstado'
import { RUTA_DE, type DireccionOrden, type DocumentoListado, type OrdenVentas } from '../types'

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

const COLUMNAS: { clave: OrdenVentas; etiqueta: string; num?: boolean }[] = [
  { clave: 'numero', etiqueta: 'Número' },
  { clave: 'cliente', etiqueta: 'Cliente' },
  { clave: 'fecha', etiqueta: 'Fecha' },
  { clave: 'total', etiqueta: 'Total', num: true },
]

const observaciones = (n: number) => `${n} ${n === 1 ? 'observación' : 'observaciones'}`

/**
 * El mismo listado para los tres documentos.
 *
 * En el legacy también era el mismo, sólo que copiado y pegado tres veces
 * (`renderCotList`, `renderPedidos`, `renderNotasEntrega`), con las tres
 * copias divergiendo de a poco.
 *
 * Tabla en desktop y tarjetas en mobile: una tabla de siete columnas en 390px
 * obliga a hacer scroll horizontal en toda la página, que es justo lo que no
 * queremos. El vacío y el error los resuelve la página.
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

  if (cargando && filas.length === 0) {
    return (
      <div className={tabla.contenedor}>
        <SkeletonRows rows={5} columns={isMobile ? 2 : 6} label="Cargando documentos…" />
      </div>
    )
  }
  if (filas.length === 0) return null

  if (isMobile) {
    return (
      <ul className={tabla.tarjetas}>
        {filas.map((d) => (
          <li key={d.id}>
            <Link to={`${RUTA_DE[d.tipo]}/${d.id}`} className={tabla.tarjeta}>
              <span className={tabla.tarjetaTitulo}>{d.numero}</span>
              <span className={tabla.tarjetaDerecha}>
                <ChipEstado estado={presentarEstado(d.tipo, d.estado)} />
              </span>
              <span className={tabla.tarjetaTexto}>{d.clienteNombre}</span>
              <span className={tabla.tarjetaMeta}>{formatearFecha(d.fecha)}</span>
              <span className={`${tabla.tarjetaDerecha} ${tabla.tarjetaImporte}`}>{formatearImporte(d.total, d.moneda)}</span>
              {d.necesitaRevision ? (
                <span className={tabla.tarjetaAviso}>
                  <Icon name="alert-triangle" size={16} />
                  {observaciones(d.motivosRevision.length)}
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
            {haySeleccion ? (
              <th scope="col" className={tabla.check}>
                <input
                  type="checkbox"
                  checked={todosMarcados}
                  aria-label="Seleccionar todos los de esta página"
                  onChange={(e) => onSeleccionarTodos?.(e.target.checked)}
                />
              </th>
            ) : null}
            {COLUMNAS.map((c) => {
              const activa = orden === c.clave
              return (
                <th
                  key={c.clave}
                  scope="col"
                  className={c.num ? tabla.num : undefined}
                  aria-sort={activa ? (direccion === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" className={tabla.orden} onClick={() => onOrdenar(c.clave)}>
                    {c.etiqueta}
                    {activa ? <Icon name={direccion === 'asc' ? 'arrow-up' : 'arrow-down'} size={16} className={tabla.ordenIcono} /> : null}
                  </button>
                </th>
              )
            })}
            <th scope="col">Título</th>
            <th scope="col">Estado</th>
            {etiquetaOrigen ? <th scope="col">{etiquetaOrigen}</th> : null}
            <th scope="col">Vendedor</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((d) => (
            <tr key={d.id} className={haySeleccion && seleccionados.has(d.id) ? tabla.seleccionada : undefined}>
              {haySeleccion ? (
                <td className={tabla.check}>
                  <input
                    type="checkbox"
                    checked={seleccionados.has(d.id)}
                    aria-label={`Seleccionar ${d.numero}`}
                    onChange={(e) => onSeleccionar(d.id, e.target.checked)}
                  />
                </td>
              ) : null}
              <td className={tabla.nowrap}>
                <Link to={`${RUTA_DE[d.tipo]}/${d.id}`} className={tabla.enlace}>
                  {d.numero}
                </Link>
                {d.necesitaRevision ? (
                  <span className={tabla.marca} title={d.motivosRevision.join(', ')}>
                    <Icon name="alert-triangle" size={16} />
                    <span className="sr-only">{observaciones(d.motivosRevision.length)}</span>
                  </span>
                ) : null}
              </td>
              <td className={tabla.texto}>{d.clienteNombre}</td>
              <td className={tabla.nowrap}>{formatearFecha(d.fecha)}</td>
              <td className={tabla.num}>{formatearImporte(d.total, d.moneda)}</td>
              <td className={`${tabla.secundario} ${tabla.texto}`}>{d.titulo ?? '—'}</td>
              <td>
                <span className={tabla.estados}>
                  <ChipEstado estado={presentarEstado(d.tipo, d.estado)} />
                  {d.estadoSecundario ? <ChipEstado estado={presentarCumplimiento(d.estadoSecundario)} /> : null}
                </span>
              </td>
              {etiquetaOrigen ? <td className={tabla.nowrap}>{d.origen ?? '—'}</td> : null}
              <td className={`${tabla.nowrap} ${tabla.secundario}`}>{d.vendedor ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
