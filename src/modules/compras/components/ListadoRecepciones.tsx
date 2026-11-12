import { Link, useLocation, useNavigate } from 'react-router-dom'
import { filaClickeable } from '@/components/tables/filaClickeable'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { Icon } from '@/components/icons/Icon'
import { SkeletonRows } from '@/components/ui/Skeleton'
import tabla from '@/components/tables/Tabla.module.css'
import { formatearFecha, formatearNumero } from '../lib/formato'
import { ChipRecepcionDoc } from './ChipEstado'
import type { DireccionOrden, OrdenRecepciones, RecepcionListado } from '../types'

export interface ListadoRecepcionesProps {
  filas: readonly RecepcionListado[]
  orden: OrdenRecepciones
  direccion: DireccionOrden
  onOrdenar: (orden: OrdenRecepciones) => void
  cargando: boolean
  /** Ids seleccionados. Sin `onSeleccionar` no se muestran las casillas. */
  seleccionados?: ReadonlySet<string>
  onSeleccionar?: (id: string, marcado: boolean) => void
  onSeleccionarTodos?: (marcado: boolean) => void
}

/**
 * Las columnas, en el orden del listado de notas de entrega de VENTA —Número,
 * Proveedor/Cliente, Fecha, …, Estado, Pedido de origen—, para que las dos
 * notas de entrega se lean igual. En vez de Total van las unidades: una
 * recepción **no está valorizada** en el schema y poner un importe sería
 * inventarlo.
 */
const ORDENABLES: { clave: OrdenRecepciones; etiqueta: string }[] = [
  { clave: 'numero', etiqueta: 'Número' },
  { clave: 'proveedor', etiqueta: 'Proveedor' },
  { clave: 'fecha', etiqueta: 'Fecha' },
]

/**
 * El listado de notas de entrega de proveedor (recepciones).
 *
 * Mismo formato que el de ventas (`ListadoDocumentos`): casillas para exportar
 * una selección, la fila entera abre la nota, las flechas de orden siempre a la
 * vista. Tabla en escritorio, tarjetas en mobile. El vacío y el error los
 * resuelve la página.
 */
export function ListadoRecepciones({
  filas,
  orden,
  direccion,
  onOrdenar,
  cargando,
  seleccionados,
  onSeleccionar,
  onSeleccionarTodos,
}: ListadoRecepcionesProps) {
  const isMobile = useIsMobile()
  const { search } = useLocation()
  const navegar = useNavigate()
  const vuelta = search === '' ? undefined : { volverA: search }
  const haySeleccion = onSeleccionar !== undefined && seleccionados !== undefined
  const todosMarcados = haySeleccion && filas.length > 0 && filas.every((r) => seleccionados.has(r.id))

  if (cargando && filas.length === 0) {
    return (
      <div className={tabla.contenedor}>
        <SkeletonRows rows={5} columns={isMobile ? 2 : 6} label="Cargando notas de entrega…" />
      </div>
    )
  }
  if (filas.length === 0) return null

  if (isMobile) {
    return (
      <ul className={tabla.tarjetas}>
        {filas.map((r) => (
          <li key={r.id}>
            <Link to={`/compras/recepciones/${r.id}`} state={vuelta} className={tabla.tarjeta}>
              <span className={tabla.tarjetaTitulo}>{r.numero}</span>
              <span className={tabla.tarjetaDerecha}>
                <ChipRecepcionDoc estado={r.estado} />
              </span>
              <span className={tabla.tarjetaTexto}>{r.proveedor}</span>
              <span className={tabla.tarjetaMeta}>{formatearFecha(r.fecha)}</span>
              <span className={`${tabla.tarjetaDerecha} ${tabla.tarjetaImporte}`}>{formatearNumero(r.unidades)} u.</span>
            </Link>
          </li>
        ))}
      </ul>
    )
  }

  const cabecera = (clave: OrdenRecepciones, etiqueta: string, clase?: string) => {
    const activa = orden === clave
    return (
      <th
        key={clave}
        scope="col"
        className={clase}
        aria-sort={activa ? (direccion === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <button type="button" className={tabla.orden} onClick={() => onOrdenar(clave)}>
          {etiqueta}
          <Icon
            name={activa && direccion === 'desc' ? 'arrow-down' : 'arrow-up'}
            size={16}
            className={activa ? tabla.ordenIcono : tabla.ordenIconoApagado}
          />
        </button>
      </th>
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
                  aria-label="Seleccionar todas las de esta página"
                  onChange={(e) => onSeleccionarTodos?.(e.target.checked)}
                />
              </th>
            ) : null}
            {ORDENABLES.map((c) => cabecera(c.clave, c.etiqueta))}
            <th scope="col" className={tabla.num}>
              Unidades
            </th>
            <th scope="col">Estado</th>
            {cabecera('pedido', 'Pedido', tabla.ocultaBajoLg)}
            <th scope="col" className={tabla.ocultaBajoXl}>
              Depósito
            </th>
            <th scope="col" className={tabla.ocultaBajoXl}>
              Creada por
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((r) => (
            <tr
              key={r.id}
              className={`${tabla.filaClicable} ${haySeleccion && seleccionados.has(r.id) ? tabla.seleccionada : ''}`}
              {...filaClickeable(() => void navegar(`/compras/recepciones/${r.id}`, { state: vuelta }))}
            >
              {haySeleccion ? (
                <td className={tabla.check}>
                  <input
                    type="checkbox"
                    checked={seleccionados.has(r.id)}
                    aria-label={`Seleccionar ${r.numero}`}
                    onChange={(e) => onSeleccionar(r.id, e.target.checked)}
                  />
                </td>
              ) : null}
              <td className={tabla.nowrap}>
                <Link to={`/compras/recepciones/${r.id}`} state={vuelta} className={tabla.enlace}>
                  {r.numero}
                </Link>
              </td>
              <td className={tabla.texto} title={r.proveedor}>
                {r.proveedor}
              </td>
              <td className={tabla.nowrap}>{formatearFecha(r.fecha)}</td>
              <td className={tabla.num}>{formatearNumero(r.unidades)}</td>
              <td>
                <span className={tabla.estados}>
                  <ChipRecepcionDoc estado={r.estado} />
                </span>
              </td>
              <td className={`${tabla.nowrap} ${tabla.ocultaBajoLg}`}>
                {r.pedidoId && r.pedidoNumero ? (
                  <Link to={`/compras/pedidos/${r.pedidoId}`} className={tabla.enlaceSuave}>
                    {r.pedidoNumero}
                  </Link>
                ) : (
                  '—'
                )}
              </td>
              <td className={`${tabla.secundario} ${tabla.ocultaBajoXl}`} title={r.deposito}>
                {r.deposito}
              </td>
              <td className={`${tabla.nowrap} ${tabla.secundario} ${tabla.ocultaBajoXl}`} title={r.autor ?? undefined}>
                {r.autor ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
