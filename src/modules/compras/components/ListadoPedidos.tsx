import { Link } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { Icon } from '@/components/icons/Icon'
import { SkeletonRows } from '@/components/ui/Skeleton'
import tabla from '@/components/tables/Tabla.module.css'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { ChipEstado, ChipRecepcion } from './ChipEstado'
import type { DireccionOrden, OrdenPedidos, PedidoCompraListado } from '../types'

export interface ListadoPedidosProps {
  filas: readonly PedidoCompraListado[]
  orden: OrdenPedidos
  direccion: DireccionOrden
  onOrdenar: (orden: OrdenPedidos) => void
  cargando: boolean
}

const COLUMNAS: { clave: OrdenPedidos; etiqueta: string; num?: boolean }[] = [
  { clave: 'numero', etiqueta: 'Número' },
  { clave: 'fecha', etiqueta: 'Fecha' },
  { clave: 'proveedor', etiqueta: 'Proveedor' },
  { clave: 'total', etiqueta: 'Total', num: true },
  { clave: 'eta', etiqueta: 'Llegada estimada' },
]

/** La fecha estimada, o que falta: «sin fecha» no es lo mismo que vacío. */
function eta(fecha: string | null): { texto: string; falta: boolean } {
  return fecha ? { texto: formatearFecha(fecha), falta: false } : { texto: 'sin fecha estimada', falta: true }
}

/**
 * El listado de pedidos de compra: tabla en escritorio, tarjetas en mobile.
 * El vacío y el error los resuelve la página (Fase 13).
 */
export function ListadoPedidos({ filas, orden, direccion, onOrdenar, cargando }: ListadoPedidosProps) {
  const isMobile = useIsMobile()

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
        {filas.map((p) => {
          const e = eta(p.fechaEstimada)
          return (
            <li key={p.id}>
              <Link to={`/compras/pedidos/${p.id}`} className={tabla.tarjeta}>
                <span className={tabla.tarjetaTitulo}>{p.numero}</span>
                <span className={`${tabla.tarjetaDerecha} ${tabla.tarjetaMeta}`}>{formatearFecha(p.fecha)}</span>
                <span className={tabla.tarjetaTexto}>{p.proveedor}</span>
                <span className={tabla.tarjetaMeta}>Llegada: {e.texto}</span>
                <span className={`${tabla.tarjetaDerecha} ${tabla.tarjetaImporte}`}>{formatearImporte(p.total, p.moneda)}</span>
                <span className={`${tabla.tarjetaTexto} ${tabla.estados}`}>
                  <ChipEstado estado={p.estado} />
                  <ChipRecepcion estado={p.estadoRecepcion} />
                </span>
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
            <th scope="col">Estado</th>
            <th scope="col" className={tabla.num}>
              Líneas
            </th>
            <th scope="col">Creado por</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((p) => {
            const e = eta(p.fechaEstimada)
            return (
              <tr key={p.id}>
                <td className={tabla.nowrap}>
                  <Link to={`/compras/pedidos/${p.id}`} className={tabla.enlace}>
                    {p.numero}
                  </Link>
                </td>
                <td className={tabla.nowrap}>{formatearFecha(p.fecha)}</td>
                <td className={tabla.texto} title={p.proveedor}>
                  {/* Se mantiene el acceso directo a la ficha del proveedor. */}
                  <Link to={`/compras/proveedores/${p.proveedorId}`} className={tabla.enlaceSuave}>
                    {p.proveedor}
                  </Link>
                </td>
                <td className={tabla.num}>{formatearImporte(p.total, p.moneda)}</td>
                <td className={`${tabla.nowrap} ${e.falta ? tabla.secundario : ''}`}>{e.texto}</td>
                <td>
                  <span className={tabla.estados}>
                    <ChipEstado estado={p.estado} />
                    <ChipRecepcion estado={p.estadoRecepcion} />
                  </span>
                </td>
                <td className={tabla.num}>{p.lineas}</td>
                <td className={tabla.secundario} title={p.autor ?? undefined}>
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
