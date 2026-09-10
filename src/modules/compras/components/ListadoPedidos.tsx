import { Link } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { ChipEstado, ChipRecepcion } from './ChipEstado'
import type { DireccionOrden, OrdenPedidos, PedidoCompraListado } from '../types'
import styles from './ListadoPedidos.module.css'

export interface ListadoPedidosProps {
  filas: readonly PedidoCompraListado[]
  orden: OrdenPedidos
  direccion: DireccionOrden
  onOrdenar: (orden: OrdenPedidos) => void
  cargando: boolean
}

const COLUMNAS: { clave: OrdenPedidos; etiqueta: string }[] = [
  { clave: 'numero', etiqueta: 'Número' },
  { clave: 'fecha', etiqueta: 'Fecha' },
  { clave: 'proveedor', etiqueta: 'Proveedor' },
  { clave: 'total', etiqueta: 'Total' },
  { clave: 'eta', etiqueta: 'Llegada estimada' },
]

function flecha(activa: boolean, direccion: DireccionOrden): string {
  if (!activa) return ''
  return direccion === 'asc' ? ' ↑' : ' ↓'
}

/** Sin ETA no es un hueco: es «todavía no se sabe», y se dice. */
function eta(fecha: string | null): { texto: string; falta: boolean } {
  return fecha ? { texto: formatearFecha(fecha), falta: false }
               : { texto: 'sin fecha estimada', falta: true }
}

/**
 * El listado de pedidos de compra.
 *
 * Tabla en escritorio y tarjetas en mobile. El importe **siempre lleva su
 * moneda al lado**: en este listado conviven pedidos en USD, ARS y EUR, y un
 * número suelto no significa nada. Por la misma razón no hay una fila de
 * «total general»: sumar monedas distintas es exactamente lo que hacía el
 * legacy.
 */
export function ListadoPedidos({
  filas,
  orden,
  direccion,
  onOrdenar,
  cargando,
}: ListadoPedidosProps) {
  const isMobile = useIsMobile()

  if (!cargando && filas.length === 0) {
    return <p className={styles.vacio}>No hay pedidos que coincidan con estos filtros.</p>
  }

  if (isMobile) {
    return (
      <ul className={styles.tarjetas}>
        {filas.map((p) => {
          const e = eta(p.fechaEstimada)
          return (
            <li key={p.id}>
              <Link to={`/compras/pedidos/${p.id}`} className={styles.tarjeta}>
                <span className={styles.tarjetaNumero}>{p.numero}</span>
                <span className={styles.tarjetaFecha}>{formatearFecha(p.fecha)}</span>
                <span className={styles.tarjetaProveedor}>{p.proveedor}</span>
                <span className={styles.tarjetaTotal}>
                  {formatearImporte(p.total, p.moneda)}
                </span>
                <span className={e.falta ? styles.tarjetaFalta : styles.tarjetaDato}>
                  Llegada: {e.texto}
                </span>
                <span className={styles.tarjetaChips}>
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
    <div className={styles.scroll}>
      <table className={styles.tabla}>
        <thead>
          <tr>
            {COLUMNAS.map((c) => (
              <th
                key={c.clave}
                scope="col"
                className={c.clave === 'total' ? styles.derecha : undefined}
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
            <th scope="col">Estado</th>
            <th scope="col">Recepción</th>
            <th scope="col" className={styles.derecha}>
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
                <td className={styles.numero}>
                  <Link to={`/compras/pedidos/${p.id}`} className={styles.enlace}>
                    {p.numero}
                  </Link>
                </td>
                <td className={styles.numero}>{formatearFecha(p.fecha)}</td>
                <td className={styles.recorta} title={p.proveedor}>
                  <Link to={`/compras/proveedores/${p.proveedorId}`} className={styles.enlaceSuave}>
                    {p.proveedor}
                  </Link>
                </td>
                <td className={styles.derecha}>{formatearImporte(p.total, p.moneda)}</td>
                <td className={e.falta ? styles.falta : styles.numero}>{e.texto}</td>
                <td>
                  <ChipEstado estado={p.estado} />
                </td>
                <td>
                  <ChipRecepcion estado={p.estadoRecepcion} />
                </td>
                <td className={styles.derecha}>{p.lineas}</td>
                <td className={styles.recorta} title={p.autor ?? undefined}>
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
