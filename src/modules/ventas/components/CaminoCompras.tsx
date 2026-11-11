import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { cx } from '@/utils/cx'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { fechaCorta, resumirCompras, rutaCompraDeVenta } from '../lib/abastecimiento'
import { abastecimientoDeVenta } from '../services/abastecimiento'
import styles from './CaminoCompras.module.css'

/**
 * El camino de COMPRAS de una venta, debajo del circuito de la venta (Fase 240).
 *
 * «Quiero que la compra se sume a la trazabilidad, pero abajo, como un camino
 * aparte.» Dos pasos más chicos, en el color de Compras, colgando de la
 * cadena Cotización → Pedido → Entrega → Factura:
 *
 *   🛒 Compra  —  📦 Recepción
 *
 * · Compra: sin pedido a proveedor, se puede generar (el «+», abre el alta con
 *   lo pendiente cargado); con pedidos, lleva al primero y dice cuántos son.
 * · Recepción: recibido (pintado), parcial (a medias) o en camino, con la
 *   fecha estimada en el rótulo.
 */
export function CaminoCompras({
  tipo,
  documentoId,
  numero,
  puedeComprar,
}: {
  tipo: 'cotizacion' | 'pedido'
  documentoId: string
  numero: string | null
  puedeComprar: boolean
}) {
  const { activa } = useEmpresa()
  const navegar = useNavigate()
  const datos = useQuery({
    queryKey: ['ventas', activa?.companyId, 'abastecimiento', tipo, documentoId],
    queryFn: () => abastecimientoDeVenta(tipo, documentoId),
    enabled: !!activa,
    staleTime: 30_000,
  })
  if (!datos.data || datos.data.length === 0) return null

  const r = resumirCompras(datos.data)
  const hayCompra = r.pedidos.length > 0
  const recibidoTodo = hayCompra && r.recibido >= r.paraVenta
  const parcial = hayCompra && r.recibido > 0 && !recibidoTodo
  const primero = r.pedidos[0]

  const tituloCompra = hayCompra
    ? `Pedido a proveedor ${r.pedidos.map((p) => p.numero).join(', ')}${r.pendienteSinCompra > 0 ? ` · faltan ${r.pendienteSinCompra} u. sin comprar` : ''}`
    : puedeComprar
      ? 'Generar pedido a proveedor'
      : 'Sin pedido a proveedor'
  const rotuloRecepcion = recibidoTodo
    ? 'Recibido'
    : parcial
      ? 'Parcial'
      : hayCompra && r.llegada
        ? `Llega ${fechaCorta(r.llegada).slice(0, 5)}`
        : 'Recepción'
  const tituloRecepcion = !hayCompra
    ? 'Recepción: todavía no hay compra'
    : recibidoTodo
      ? 'Todo lo comprado para esta venta ya llegó'
      : parcial
        ? `Llegó ${r.recibido} de ${r.paraVenta} u.`
        : r.llegada
          ? `En camino · llega ${fechaCorta(r.llegada)}`
          : 'En camino · sin fecha de llegada'

  return (
    <nav className={styles.camino} aria-label="Compras de esta venta">
      <span className={styles.rama} aria-hidden="true" />
      <ol className={styles.pasos}>
        <li className={cx(styles.paso, hayCompra && styles.pasoHecho)}>
          {hayCompra && primero ? (
            <Link
              to={`/compras/pedidos/${primero.id}`}
              className={cx(styles.circulo, styles.hecho)}
              title={tituloCompra}
            >
              <Cara emoji="🛒" texto={tituloCompra} />
              {r.pedidos.length > 1 ? (
                <span className={styles.cuenta}>{r.pedidos.length}</span>
              ) : null}
            </Link>
          ) : puedeComprar ? (
            <button
              type="button"
              className={cx(styles.circulo, styles.generable)}
              title={tituloCompra}
              onClick={() => void navegar(rutaCompraDeVenta(tipo, documentoId, numero))}
            >
              <Cara emoji="🛒" texto={tituloCompra} />
              <span className={styles.mas} aria-hidden="true">
                +
              </span>
            </button>
          ) : (
            <span className={cx(styles.circulo, styles.pendiente)} title={tituloCompra}>
              <Cara emoji="🛒" texto={tituloCompra} />
            </span>
          )}
          <span className={styles.rotulo} aria-hidden="true">
            Compra
          </span>
        </li>
        <li
          className={cx(
            styles.paso,
            recibidoTodo && styles.pasoHecho,
            parcial && styles.pasoParcial,
          )}
        >
          <span
            className={cx(
              styles.circulo,
              recibidoTodo
                ? styles.hecho
                : parcial
                  ? styles.parcial
                  : hayCompra
                    ? styles.enCamino
                    : styles.pendiente,
            )}
            title={tituloRecepcion}
          >
            <Cara emoji="📦" texto={tituloRecepcion} />
          </span>
          <span className={styles.rotulo} aria-hidden="true">
            {rotuloRecepcion}
          </span>
        </li>
      </ol>
    </nav>
  )
}

function Cara({ emoji, texto }: { emoji: string; texto: string }) {
  return (
    <>
      <span className={styles.emoji} aria-hidden="true">
        {emoji}
      </span>
      <span className="sr-only">{texto}</span>
    </>
  )
}

/** La cadena de la venta con el camino de compras colgando debajo. */
export function ConCaminoDeCompras({
  children,
  camino,
}: {
  children: ReactNode
  camino: ReactNode
}) {
  return (
    <div className={styles.dosCaminos}>
      {children}
      {camino}
    </div>
  )
}
