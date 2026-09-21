import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { formatearFecha, formatearImporte } from '../lib/formato'
import type { DocumentoReciente, TipoDeDocumento } from '../types'
import styles from './HistorialReciente.module.css'

export interface HistorialRecienteProps {
  documentos: readonly DocumentoReciente[]
}

const RUTA: Record<TipoDeDocumento, string> = {
  cotizacion: '/ventas/cotizaciones',
  pedido: '/ventas/pedidos',
  entrega: '/ventas/entregas',
}

const TIPO: Record<TipoDeDocumento, string> = {
  cotizacion: 'Cotización',
  pedido: 'Pedido',
  entrega: 'Nota de entrega',
}

/** Los estados que devuelve la base, en castellano y sin inventar ninguno. */
const ESTADO: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired: 'Vencida',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
  pending: 'Pendiente',
  partially_reserved: 'Reservado en parte',
  reserved: 'Reservado',
  partially_delivered: 'Entregado en parte',
  delivered: 'Entregado',
  shipped: 'Despachado',
}

const tono = (estado: string | null): 'neutral' | 'success' | 'warning' | 'danger' => {
  if (estado === 'accepted' || estado === 'confirmed' || estado === 'delivered') return 'success'
  if (estado === 'rejected' || estado === 'cancelled' || estado === 'expired') return 'danger'
  if (estado === 'sent' || estado === 'pending' || estado === 'partially_delivered') return 'warning'
  return 'neutral'
}

/**
 * Los últimos documentos del cliente, en orden y clickeables.
 *
 * Hasta la Fase 19 · E7 esto mostraba TRES líneas —la última cotización, el
 * último pedido y la última entrega— porque era lo que traía el resumen. Con
 * eso se podía decir «la última cotización fue ésta», pero no leer qué viene
 * pasando: cinco cotizaciones seguidas en dos semanas y ningún pedido es una
 * historia, y con una línea por tipo no se ve.
 *
 * Cada documento **navega a su detalle**, que es la navegación que el ERP ya
 * tiene. No se abre otro modal encima del panel: sería una tercera capa sobre
 * un listado, y volver de ahí no significa nada.
 */
export function HistorialReciente({ documentos }: HistorialRecienteProps) {
  if (documentos.length === 0) {
    return <p className={styles.vacio}>Todavía no tiene documentos.</p>
  }

  return (
    <ul className={styles.lista}>
      {documentos.map((d) => (
        <li key={`${d.tipo}-${d.id}`}>
          <Link to={`${RUTA[d.tipo]}/${d.id}`} className={styles.fila}>
            <span className={styles.fecha}>{formatearFecha(d.fecha)}</span>
            <span className={styles.doc}>
              <span className={styles.tipo}>{TIPO[d.tipo]}</span>{' '}
              <span className={styles.numero}>{d.numero ?? 'Sin número'}</span>
            </span>
            {/* El importe con su moneda, siempre. Dos líneas de esta lista
                pueden estar en monedas distintas y no se suman ni se comparan:
                cada una dice la suya. */}
            <span className={styles.importe}>
              {d.total === null ? '—' : formatearImporte(d.total, d.moneda)}
            </span>
            <span className={styles.estado}>
              <Badge tone={tono(d.estado)}>{ESTADO[d.estado ?? ''] ?? d.estado ?? '—'}</Badge>
              {/* El pedido tiene dos estados: el comercial y el de entrega.
                  Mostrar sólo «Confirmado» esconde que todavía no salió. */}
              {d.tipo === 'pedido' && d.entrega ? (
                <Badge tone={tono(d.entrega)} outline>
                  {ESTADO[d.entrega] ?? d.entrega}
                </Badge>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
