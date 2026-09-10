import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { ChipFactura, ChipRecepcionDoc } from './ChipEstado'
import { formatearFecha, formatearImporte, formatearNumero } from '../lib/formato'
import { listarRecepciones } from '../services/recepciones'
import { facturasDelPedido } from '../services/pedidos'
import {
  FILTROS_RECEPCIONES_INICIALES,
  type PedidoCompraDetalle,
  type RelacionadosPedido,
} from '../types'
import styles from './PanelCompras.module.css'

export interface PanelRelacionadosPedidoProps {
  pedido: PedidoCompraDetalle
  datos: RelacionadosPedido | undefined
  cargando: boolean
}

/**
 * Lo que cuelga del pedido.
 *
 * El proveedor, las recepciones y las facturas de proveedor: los tres de
 * verdad, con su número, su estado y su link.
 *
 * Las facturas **no cuelgan del pedido por una clave en la cabecera**: se
 * derivan por las líneas —factura → línea de pedido—, que es como está
 * modelado desde la entrega 1. Una factura puede tocar varias órdenes.
 *
 * **No se muestra ninguna relación con Ventas.** Ese vínculo no existe en el
 * schema y reconstruirlo por fecha parecida, mismo SKU o cantidades parecidas
 * sería inventarlo.
 */
export function PanelRelacionadosPedido({
  pedido,
  datos,
  cargando,
}: PanelRelacionadosPedidoProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  const recepciones = useQuery({
    queryKey: ['compras', companyId, 'recepciones', 'del-pedido', pedido.id],
    queryFn: () =>
      listarRecepciones(companyId!, {
        ...FILTROS_RECEPCIONES_INICIALES,
        pedidoId: pedido.id,
        porPagina: 100,
        orden: 'numero',
        direccion: 'asc',
      }),
    enabled: companyId !== null,
    staleTime: 30_000,
  })

  const facturas = useQuery({
    queryKey: ['compras', companyId, 'facturas', 'del-pedido', pedido.id],
    queryFn: () => facturasDelPedido(companyId!, pedido.id),
    enabled: companyId !== null,
    staleTime: 30_000,
  })

  if (cargando) return <p className={styles.nota}>Cargando…</p>

  const filas = recepciones.data?.filas ?? []
  const filasFactura = facturas.data ?? []

  return (
    <div className={styles.panel}>
      <dl className={styles.numeros}>
        <div className={styles.numero}>
          <dt className={styles.etiqueta}>Proveedor</dt>
          <dd className={styles.valorTexto}>
            <Link className={styles.enlace} to={`/compras/proveedores/${pedido.proveedorId}`}>
              {pedido.proveedor}
            </Link>
            {pedido.proveedorReferencia ? (
              <span className={styles.ref}> · {pedido.proveedorReferencia}</span>
            ) : null}
          </dd>
        </div>
        <div className={styles.numero}>
          <dt className={styles.etiqueta}>Notas de entrada</dt>
          <dd className={styles.valor}>{datos?.recepciones ?? 0}</dd>
        </div>
        <div className={styles.numero}>
          <dt className={styles.etiqueta}>Facturas de proveedor</dt>
          <dd className={styles.valor}>{datos?.facturas ?? 0}</dd>
        </div>
      </dl>

      {filas.length > 0 ? (
        <ul className={styles.lista}>
          {filas.map((r) => (
            <li key={r.id} className={styles.item}>
              <Link to={`/compras/recepciones/${r.id}`} className={styles.enlace}>
                {r.numero}
              </Link>
              <span className={styles.meta}>
                {formatearFecha(r.fecha)} · {r.deposito} · {formatearNumero(r.unidades)} unidades
              </span>
              <ChipRecepcionDoc estado={r.estado} />
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.nota}>
          Este pedido todavía no tiene recepciones.
          {pedido.estado === 'confirmed'
            ? ' Usá «Recibir mercadería» para registrar la primera.'
            : ' Se recibe contra un pedido confirmado.'}
        </p>
      )}

      {filasFactura.length > 0 ? (
        <ul className={styles.lista}>
          {filasFactura.map((f) => (
            <li key={f.id} className={styles.item}>
              <Link to={`/compras/facturas/${f.id}`} className={styles.enlace}>
                {f.numeroProveedor ?? f.numero}
              </Link>
              <span className={styles.meta}>
                {formatearFecha(f.fecha)} · {formatearImporte(f.total, f.moneda)}
                {f.numeroProveedor ? ` · ref. ${f.numero}` : ''}
              </span>
              <ChipFactura estado={f.estado} />
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.nota}>
          Sin facturas de proveedor. Se factura lo recibido, desde «Facturar».
        </p>
      )}
    </div>
  )
}
