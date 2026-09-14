import { Link } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { formatearFecha, formatearNumero } from '../lib/formato'
import { ChipRecepcionDoc } from './ChipEstado'
import type { DireccionOrden, OrdenRecepciones, RecepcionListado } from '../types'
import { Icon } from '@/components/icons/Icon'
import { SkeletonRows } from '@/components/ui/Skeleton'
import tabla from '@/components/tables/Tabla.module.css'

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

  // El vacío y el error los resuelve la página (Fase 13).
  if (cargando && filas.length === 0) {
    return (
      <div className={tabla.contenedor}>
        <SkeletonRows rows={5} columns={isMobile ? 2 : 6} label="Cargando recepciones…" />
      </div>
    )
  }
  if (filas.length === 0) return null

  if (isMobile) {
    return (
      <ul className={tabla.tarjetas}>
        {filas.map((r) => (
          <li key={r.id}>
            <Link to={`/compras/recepciones/${r.id}`} className={tabla.tarjeta}>
              <span className={tabla.tarjetaTitulo}>{r.numero}</span>
              <span className={`${tabla.tarjetaDerecha} ${tabla.tarjetaMeta}`}>{formatearFecha(r.fecha)}</span>
              <span className={tabla.tarjetaTexto}>{r.proveedor}</span>
              <span className={`${tabla.tarjetaTexto} ${tabla.tarjetaMeta}`}>
                {r.pedidoNumero ? `Pedido ${r.pedidoNumero} · ` : ''}
                {r.deposito}
              </span>
              <span className={`${tabla.tarjetaTexto} ${tabla.tarjetaMeta}`}>
                {r.lineas} {r.lineas === 1 ? 'línea' : 'líneas'} ·{' '}
                {formatearNumero(r.unidades)} unidades
              </span>
              <span className={tabla.tarjetaTexto}>
                <ChipRecepcionDoc estado={r.estado} />
              </span>
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
            {COLUMNAS.map((c) => (
              <th
                key={c.clave}
                scope="col"
                aria-sort={
                  orden === c.clave ? (direccion === 'asc' ? 'ascending' : 'descending') : 'none'
                }
              >
                <button type="button" className={tabla.orden} onClick={() => onOrdenar(c.clave)}>
                  {c.etiqueta}
                  {orden === c.clave ? <Icon name={direccion === 'asc' ? 'arrow-up' : 'arrow-down'} size={16} className={tabla.ordenIcono} /> : null}
                </button>
              </th>
            ))}
            <th scope="col">Depósito</th>
            <th scope="col">Estado</th>
            <th scope="col" className={tabla.num}>
              Líneas
            </th>
            <th scope="col" className={tabla.num}>
              Unidades
            </th>
            <th scope="col">Creada por</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((r) => (
            <tr key={r.id}>
              <td className={tabla.nowrap}>
                <Link to={`/compras/recepciones/${r.id}`} className={tabla.enlace}>
                  {r.numero}
                </Link>
              </td>
              <td className={tabla.nowrap}>{formatearFecha(r.fecha)}</td>
              <td className={tabla.texto} title={r.proveedor}>
                <Link to={`/compras/proveedores/${r.proveedorId}`} className={tabla.enlaceSuave}>
                  {r.proveedor}
                </Link>
              </td>
              <td className={tabla.nowrap}>
                {r.pedidoId && r.pedidoNumero ? (
                  <Link to={`/compras/pedidos/${r.pedidoId}`} className={tabla.enlaceSuave}>
                    {r.pedidoNumero}
                  </Link>
                ) : (
                  '—'
                )}
              </td>
              <td className={tabla.secundario} title={r.deposito}>
                {r.deposito}
              </td>
              <td>
                <ChipRecepcionDoc estado={r.estado} />
              </td>
              <td className={tabla.num}>{r.lineas}</td>
              <td className={tabla.num}>{formatearNumero(r.unidades)}</td>
              <td className={tabla.secundario} title={r.autor ?? undefined}>
                {r.autor ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
