import type { Tono } from '@/features/pendientes/util'
import type { ProductoPendienteEntrega } from '../services/pendienteEntregar'

/**
 * Cómo se lee lo pendiente de entregar de un producto (Fase 238). Puro.
 *
 * Lo pendiente se cubre en este orden: primero el stock, después lo que viene
 * en camino de proveedores para estas ventas, y lo que queda es lo que FALTA
 * PEDIR. La barra muestra los cuatro tramos sobre lo pedido por los clientes.
 */
export function tramosDeEntrega(p: Pick<ProductoPendienteEntrega, 'pedido' | 'entregado' | 'pendiente' | 'stock' | 'enCamino'>) {
  const conStock = Math.min(Math.max(p.stock, 0), p.pendiente)
  const enCamino = Math.min(Math.max(p.enCamino, 0), p.pendiente - conStock)
  const falta = Math.max(p.pendiente - conStock - enCamino, 0)
  return { entregado: p.entregado, conStock, enCamino, falta }
}

export type FiltroEntrega = 'todos' | 'falta' | 'camino' | 'stock'

/** El estado que manda: lo más urgente primero. */
export function estadoDeEntrega(p: ProductoPendienteEntrega): { tono: Tono; texto: string; filtro: Exclude<FiltroEntrega, 'todos'> } {
  const t = tramosDeEntrega(p)
  if (t.falta > 0) return { tono: 'tFalta', texto: 'Falta pedir', filtro: 'falta' }
  if (t.enCamino > 0) return { tono: 'tCamino', texto: 'En camino', filtro: 'camino' }
  return { tono: 'tStock', texto: 'Con stock', filtro: 'stock' }
}
