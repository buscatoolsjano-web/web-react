import { Link, useLocation, useNavigate } from 'react-router-dom'
import { filaClickeable } from '@/components/tables/filaClickeable'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { Icon } from '@/components/icons/Icon'
import { SkeletonRows } from '@/components/ui/Skeleton'
import tabla from '@/components/tables/Tabla.module.css'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { ChipFactura } from './ChipEstado'
import type { DireccionOrden, FacturaListado, OrdenFacturas } from '../types'

export interface ListadoFacturasProps {
  filas: readonly FacturaListado[]
  orden: OrdenFacturas
  direccion: DireccionOrden
  onOrdenar: (orden: OrdenFacturas) => void
  cargando: boolean
  /** Ids seleccionados. Sin `onSeleccionar` no se muestran las casillas. */
  seleccionados?: ReadonlySet<string>
  onSeleccionar?: (id: string, marcado: boolean) => void
  onSeleccionarTodos?: (marcado: boolean) => void
}

/**
 * Las columnas, en el orden de los listados de Ventas —Número, Proveedor,
 * Fecha, Total, Estado—. El número es el de la factura DEL PROVEEDOR, que es
 * el que se busca; la referencia interna `FP00001` va aparte, más chica.
 */
const ORDENABLES: { clave: OrdenFacturas; etiqueta: string; num?: boolean }[] = [
  { clave: 'numeroProveedor', etiqueta: 'Número' },
  { clave: 'proveedor', etiqueta: 'Proveedor' },
  { clave: 'fecha', etiqueta: 'Fecha' },
  { clave: 'total', etiqueta: 'Total', num: true },
]

/**
 * El listado de facturas de proveedor, con el mismo formato que los de Ventas
 * (`ListadoDocumentos`): casillas para exportar una selección, la fila entera
 * abre la factura, las flechas de orden siempre a la vista. Tabla en
 * escritorio, tarjetas en mobile. El vacío y el error los resuelve la página.
 */
export function ListadoFacturas({
  filas,
  orden,
  direccion,
  onOrdenar,
  cargando,
  seleccionados,
  onSeleccionar,
  onSeleccionarTodos,
}: ListadoFacturasProps) {
  const isMobile = useIsMobile()
  const { search } = useLocation()
  const navegar = useNavigate()
  const vuelta = search === '' ? undefined : { volverA: search }
  const haySeleccion = onSeleccionar !== undefined && seleccionados !== undefined
  const todosMarcados = haySeleccion && filas.length > 0 && filas.every((f) => seleccionados.has(f.id))

  if (cargando && filas.length === 0) {
    return (
      <div className={tabla.contenedor}>
        <SkeletonRows rows={5} columns={isMobile ? 2 : 6} label="Cargando facturas…" />
      </div>
    )
  }
  if (filas.length === 0) return null

  if (isMobile) {
    return (
      <ul className={tabla.tarjetas}>
        {filas.map((f) => (
          <li key={f.id}>
            <Link to={`/compras/facturas/${f.id}`} state={vuelta} className={tabla.tarjeta}>
              <span className={tabla.tarjetaTitulo}>{f.numeroProveedor ?? f.numero}</span>
              <span className={tabla.tarjetaDerecha}>
                <ChipFactura estado={f.estado} />
              </span>
              <span className={tabla.tarjetaTexto}>{f.proveedor}</span>
              <span className={tabla.tarjetaMeta}>{formatearFecha(f.fecha)}</span>
              <span className={`${tabla.tarjetaDerecha} ${tabla.tarjetaImporte}`}>{formatearImporte(f.total, f.moneda)}</span>
            </Link>
          </li>
        ))}
      </ul>
    )
  }

  const cabecera = (clave: OrdenFacturas, etiqueta: string, clase?: string) => {
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
            {ORDENABLES.map((c) => cabecera(c.clave, c.etiqueta, c.num ? tabla.num : undefined))}
            <th scope="col">Estado</th>
            {cabecera('numero', 'Referencia', tabla.ocultaBajoLg)}
            <th scope="col" className={tabla.ocultaBajoXl}>
              Creada por
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr
              key={f.id}
              className={`${tabla.filaClicable} ${haySeleccion && seleccionados.has(f.id) ? tabla.seleccionada : ''}`}
              {...filaClickeable(() => void navegar(`/compras/facturas/${f.id}`, { state: vuelta }))}
            >
              {haySeleccion ? (
                <td className={tabla.check}>
                  <input
                    type="checkbox"
                    checked={seleccionados.has(f.id)}
                    aria-label={`Seleccionar ${f.numeroProveedor ?? f.numero}`}
                    onChange={(e) => onSeleccionar(f.id, e.target.checked)}
                  />
                </td>
              ) : null}
              <td className={tabla.nowrap}>
                <Link to={`/compras/facturas/${f.id}`} state={vuelta} className={tabla.enlace}>
                  {f.numeroProveedor ?? <span className={tabla.secundario}>sin número</span>}
                </Link>
              </td>
              <td className={tabla.texto} title={f.proveedor}>
                {f.proveedor}
              </td>
              <td className={tabla.nowrap}>{formatearFecha(f.fecha)}</td>
              <td className={tabla.num}>{formatearImporte(f.total, f.moneda)}</td>
              <td>
                <span className={tabla.estados}>
                  <ChipFactura estado={f.estado} />
                </span>
              </td>
              <td className={`${tabla.nowrap} ${tabla.secundario} ${tabla.ocultaBajoLg}`}>{f.numero}</td>
              <td className={`${tabla.nowrap} ${tabla.secundario} ${tabla.ocultaBajoXl}`} title={f.autor ?? undefined}>
                {f.autor ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
