import { Link } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { formatearFecha, formatearNumero } from '../lib/formato'
import { ChipRecepcionDoc } from './ChipEstado'
import type { DireccionOrden, OrdenRecepciones, RecepcionListado } from '../types'
import styles from './ListadoPedidos.module.css'

export interface ListadoRecepcionesProps {
  filas: readonly RecepcionListado[]
  orden: OrdenRecepciones
  direccion: DireccionOrden
  onOrdenar: (orden: OrdenRecepciones) => void
  cargando: boolean
}

const COLUMNAS: { clave: OrdenRecepciones; etiqueta: string }[] = [
  { clave: 'numero', etiqueta: 'Número' },
  { clave: 'fecha', etiqueta: 'Fecha' },
  { clave: 'proveedor', etiqueta: 'Proveedor' },
  { clave: 'pedido', etiqueta: 'Pedido' },
]

function flecha(activa: boolean, direccion: DireccionOrden): string {
  if (!activa) return ''
  return direccion === 'asc' ? ' ↑' : ' ↓'
}

/**
 * El listado de recepciones.
 *
 * Tabla en escritorio, tarjetas por debajo de 768. No hay ninguna columna de
 * importe: una recepción **no está valorizada** en el schema —ver el informe
 * de la entrega 4— y poner un número de plata acá sería inventarlo.
 */
export function ListadoRecepciones({
  filas,
  orden,
  direccion,
  onOrdenar,
  cargando,
}: ListadoRecepcionesProps) {
  const isMobile = useIsMobile()

  if (!cargando && filas.length === 0) {
    return <p className={styles.vacio}>No hay recepciones que coincidan con estos filtros.</p>
  }

  if (isMobile) {
    return (
      <ul className={styles.tarjetas}>
        {filas.map((r) => (
          <li key={r.id}>
            <Link to={`/compras/recepciones/${r.id}`} className={styles.tarjeta}>
              <span className={styles.tarjetaNumero}>{r.numero}</span>
              <span className={styles.tarjetaFecha}>{formatearFecha(r.fecha)}</span>
              <span className={styles.tarjetaProveedor}>{r.proveedor}</span>
              <span className={styles.tarjetaDato}>
                {r.pedidoNumero ? `Pedido ${r.pedidoNumero} · ` : ''}
                {r.deposito}
              </span>
              <span className={styles.tarjetaDato}>
                {r.lineas} {r.lineas === 1 ? 'línea' : 'líneas'} ·{' '}
                {formatearNumero(r.unidades)} unidades
              </span>
              <span className={styles.tarjetaChips}>
                <ChipRecepcionDoc estado={r.estado} />
              </span>
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
            <th scope="col">Depósito</th>
            <th scope="col">Estado</th>
            <th scope="col" className={styles.derecha}>
              Líneas
            </th>
            <th scope="col" className={styles.derecha}>
              Unidades
            </th>
            <th scope="col">Creada por</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((r) => (
            <tr key={r.id}>
              <td className={styles.numero}>
                <Link to={`/compras/recepciones/${r.id}`} className={styles.enlace}>
                  {r.numero}
                </Link>
              </td>
              <td className={styles.numero}>{formatearFecha(r.fecha)}</td>
              <td className={styles.recorta} title={r.proveedor}>
                <Link to={`/compras/proveedores/${r.proveedorId}`} className={styles.enlaceSuave}>
                  {r.proveedor}
                </Link>
              </td>
              <td className={styles.numero}>
                {r.pedidoId && r.pedidoNumero ? (
                  <Link to={`/compras/pedidos/${r.pedidoId}`} className={styles.enlaceSuave}>
                    {r.pedidoNumero}
                  </Link>
                ) : (
                  '—'
                )}
              </td>
              <td className={styles.recorta} title={r.deposito}>
                {r.deposito}
              </td>
              <td>
                <ChipRecepcionDoc estado={r.estado} />
              </td>
              <td className={styles.derecha}>{r.lineas}</td>
              <td className={styles.derecha}>{formatearNumero(r.unidades)}</td>
              <td className={styles.recorta} title={r.autor ?? undefined}>
                {r.autor ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
