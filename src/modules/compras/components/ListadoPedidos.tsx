import { Link, useLocation, useNavigate } from 'react-router-dom'
import { filaClickeable } from '@/components/tables/filaClickeable'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { Icon } from '@/components/icons/Icon'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { SkeletonRows } from '@/components/ui/Skeleton'
import tabla from '@/components/tables/Tabla.module.css'
import { formatearFecha, formatearImporte } from '../lib/formato'
import type { DireccionOrden, OrdenPedidos, PedidoCompraListado } from '../types'

export interface ListadoPedidosProps {
  filas: readonly PedidoCompraListado[]
  orden: OrdenPedidos
  direccion: DireccionOrden
  onOrdenar: (orden: OrdenPedidos) => void
  cargando: boolean
  /** Ids seleccionados. Sin `onSeleccionar` no se muestran las casillas. */
  seleccionados?: ReadonlySet<string>
  onSeleccionar?: (id: string, marcado: boolean) => void
  onSeleccionarTodos?: (marcado: boolean) => void
}

/**
 * Las columnas por las que se puede ordenar, en el orden en que salen: las
 * MISMAS que el listado de pedidos de venta —Número, Proveedor/Cliente, Fecha,
 * Total—, porque «los pedidos a proveedores se tienen que ver de la misma
 * manera que los pedidos de venta».
 */
const COLUMNAS: { clave: OrdenPedidos; etiqueta: string; num?: boolean }[] = [
  { clave: 'numero', etiqueta: 'Número' },
  { clave: 'proveedor', etiqueta: 'Proveedor' },
  { clave: 'fecha', etiqueta: 'Fecha' },
  { clave: 'total', etiqueta: 'Total', num: true },
]

/**
 * El estado de un pedido de compra en UN chip, con la misma regla que el de
 * venta (`presentarEstadoPedido`): manda el AVANCE DE RECEPCIÓN —«Sin
 * recibir», «Recibido en parte», «Recibido»—, y el comercial sólo cuando dice
 * algo que el avance no puede decir: que todavía es un borrador o que se
 * canceló. Antes eran dos chips, y con el pedido confirmado el primero sólo
 * repetía «Confirmado» al lado de «Recibido».
 */
function chipDePedido(p: Pick<PedidoCompraListado, 'estado' | 'estadoRecepcion'>): {
  etiqueta: string
  tono: BadgeTone
  outline?: boolean
} {
  if (p.estado === 'draft') return { etiqueta: 'Borrador', tono: 'neutral' }
  if (p.estado === 'cancelled') return { etiqueta: 'Cancelado', tono: 'danger', outline: true }
  if (p.estadoRecepcion === 'received') return { etiqueta: 'Recibido', tono: 'success' }
  if (p.estadoRecepcion === 'partially_received') return { etiqueta: 'Recibido en parte', tono: 'info' }
  return { etiqueta: 'Sin recibir', tono: 'warning' }
}

function Chip({ pedido }: { pedido: PedidoCompraListado }) {
  const c = chipDePedido(pedido)
  return (
    <Badge tone={c.tono} outline={c.outline === true}>
      {c.etiqueta}
    </Badge>
  )
}

/** La fecha estimada, o que falta: «sin fecha» no es lo mismo que vacío. */
function eta(fecha: string | null): { texto: string; falta: boolean } {
  return fecha ? { texto: formatearFecha(fecha), falta: false } : { texto: 'sin fecha estimada', falta: true }
}

/**
 * El listado de pedidos de compra: tabla en escritorio, tarjetas en mobile.
 * Mismo formato que el de pedidos de venta (`ListadoDocumentos`): casillas
 * para exportar una selección, la fila entera abre el pedido, un solo chip de
 * estado y las flechas de orden siempre a la vista. El vacío y el error los
 * resuelve la página.
 */
export function ListadoPedidos({
  filas,
  orden,
  direccion,
  onOrdenar,
  cargando,
  seleccionados,
  onSeleccionar,
  onSeleccionarTodos,
}: ListadoPedidosProps) {
  const isMobile = useIsMobile()
  // El «volver» del detalle regresa al listado como estaba (filtros, página).
  const { search } = useLocation()
  const navegar = useNavigate()
  const vuelta = search === '' ? undefined : { volverA: search }
  const haySeleccion = onSeleccionar !== undefined && seleccionados !== undefined
  const todosMarcados = haySeleccion && filas.length > 0 && filas.every((p) => seleccionados.has(p.id))

  if (cargando && filas.length === 0) {
    return (
      <div className={tabla.contenedor}>
        <SkeletonRows rows={5} columns={isMobile ? 2 : 6} label="Cargando pedidos…" />
      </div>
    )
  }
  if (filas.length === 0) return null

  if (isMobile) {
    return (
      <ul className={tabla.tarjetas}>
        {filas.map((p) => (
          <li key={p.id}>
            <Link to={`/compras/pedidos/${p.id}`} state={vuelta} className={tabla.tarjeta}>
              <span className={tabla.tarjetaTitulo}>{p.numero}</span>
              <span className={tabla.tarjetaDerecha}>
                <Chip pedido={p} />
              </span>
              <span className={tabla.tarjetaTexto}>{p.proveedor}</span>
              <span className={tabla.tarjetaMeta}>{formatearFecha(p.fecha)}</span>
              <span className={`${tabla.tarjetaDerecha} ${tabla.tarjetaImporte}`}>{formatearImporte(p.total, p.moneda)}</span>
            </Link>
          </li>
        ))}
      </ul>
    )
  }

  const flecha = (activa: boolean) => (
    <Icon
      name={activa && direccion === 'desc' ? 'arrow-down' : 'arrow-up'}
      size={16}
      className={activa ? tabla.ordenIcono : tabla.ordenIconoApagado}
    />
  )
  const ariaSort = (clave: OrdenPedidos) =>
    orden === clave ? (direccion === 'asc' ? 'ascending' : 'descending') : 'none'

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
            {COLUMNAS.map((c) => (
              <th key={c.clave} scope="col" className={c.num ? tabla.num : undefined} aria-sort={ariaSort(c.clave)}>
                <button type="button" className={tabla.orden} onClick={() => onOrdenar(c.clave)}>
                  {c.etiqueta}
                  {flecha(orden === c.clave)}
                </button>
              </th>
            ))}
            <th scope="col">Estado</th>
            <th scope="col" className={tabla.ocultaBajoLg} aria-sort={ariaSort('eta')}>
              <button type="button" className={tabla.orden} onClick={() => onOrdenar('eta')}>
                Llegada
                {flecha(orden === 'eta')}
              </button>
            </th>
            <th scope="col" className={tabla.ocultaBajoXl}>
              Creado por
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((p) => {
            const e = eta(p.fechaEstimada)
            return (
              <tr
                key={p.id}
                className={`${tabla.filaClicable} ${haySeleccion && seleccionados.has(p.id) ? tabla.seleccionada : ''}`}
                {...filaClickeable(() => void navegar(`/compras/pedidos/${p.id}`, { state: vuelta }))}
              >
                {haySeleccion ? (
                  <td className={tabla.check}>
                    <input
                      type="checkbox"
                      checked={seleccionados.has(p.id)}
                      aria-label={`Seleccionar ${p.numero}`}
                      onChange={(ev) => onSeleccionar(p.id, ev.target.checked)}
                    />
                  </td>
                ) : null}
                <td className={tabla.nowrap}>
                  <Link to={`/compras/pedidos/${p.id}`} state={vuelta} className={tabla.enlace}>
                    {p.numero}
                  </Link>
                </td>
                <td className={tabla.texto} title={p.proveedor}>
                  {p.proveedor}
                </td>
                <td className={tabla.nowrap}>{formatearFecha(p.fecha)}</td>
                <td className={tabla.num}>{formatearImporte(p.total, p.moneda)}</td>
                <td>
                  <span className={tabla.estados}>
                    <Chip pedido={p} />
                  </span>
                </td>
                <td className={`${tabla.nowrap} ${e.falta ? tabla.secundario : ''} ${tabla.ocultaBajoLg}`}>{e.texto}</td>
                <td className={`${tabla.nowrap} ${tabla.secundario} ${tabla.ocultaBajoXl}`} title={p.autor ?? undefined}>
                  {p.autor ?? '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
