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

/** Lo que hay que HACER con un producto, en palabras, de lo más urgente a lo menos. */
export interface AccionEntrega {
  tono: Tono
  texto: string
}

export function accionesDeEntrega(p: ProductoPendienteEntrega): AccionEntrega[] {
  const t = tramosDeEntrega(p)
  const fmt = (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 2 })
  const out: AccionEntrega[] = []
  if (t.falta > 0) out.push({ tono: 'tFalta', texto: `Pedí ${fmt(t.falta)}` })
  if (t.enCamino > 0) out.push({ tono: 'tCamino', texto: `Llegan ${fmt(t.enCamino)}` })
  if (t.conStock > 0) out.push({ tono: 'tStock', texto: `Entregá ${fmt(t.conStock)} ya` })
  return out
}

/** Hace cuántos días espera el cliente: el pedido más viejo con algo pendiente. */
export function diasEsperando(p: Pick<ProductoPendienteEntrega, 'documentos'>, hoy = new Date()): number | null {
  const fechas = p.documentos.filter((d) => d.pendiente > 0).map((d) => d.fecha.slice(0, 10)).sort()
  const masVieja = fechas[0]
  if (!masVieja) return null
  const [a, m, d] = masVieja.split('-').map(Number) as [number, number, number]
  const desde = Date.UTC(a, m - 1, d)
  const ahora = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  return Math.max(0, Math.round((ahora - desde) / 86_400_000))
}

/** «Whirlpool, Mirgor y 2 más»: para quién es lo pendiente. */
export function clientesDe(p: Pick<ProductoPendienteEntrega, 'documentos'>, maximo = 2): string {
  const nombres = [...new Set(p.documentos.filter((d) => d.pendiente > 0).map((d) => d.cliente ?? 'Sin cliente'))]
  if (nombres.length <= maximo) return nombres.join(', ')
  return `${nombres.slice(0, maximo).join(', ')} y ${nombres.length - maximo} más`
}

/** Las tres secciones de la pantalla, en el orden en que hay que actuar. */
export const SECCIONES_ENTREGA = [
  { filtro: 'falta', tono: 'tFalta', titulo: 'Pedir al proveedor', ayuda: 'Se vendió y no hay stock ni compra que lo cubra.' },
  { filtro: 'camino', tono: 'tCamino', titulo: 'Esperando al proveedor', ayuda: 'Ya está comprado; se entrega cuando llegue.' },
  { filtro: 'stock', tono: 'tStock', titulo: 'Listo para entregar', ayuda: 'Hay stock: se puede armar el remito.' },
] as const satisfies readonly { filtro: Exclude<FiltroEntrega, 'todos'>; tono: Tono; titulo: string; ayuda: string }[]

/** El estado que manda: lo más urgente primero. */
export function estadoDeEntrega(p: ProductoPendienteEntrega): { tono: Tono; texto: string; filtro: Exclude<FiltroEntrega, 'todos'> } {
  const t = tramosDeEntrega(p)
  if (t.falta > 0) return { tono: 'tFalta', texto: 'Falta pedir', filtro: 'falta' }
  if (t.enCamino > 0) return { tono: 'tCamino', texto: 'En camino', filtro: 'camino' }
  return { tono: 'tStock', texto: 'Con stock', filtro: 'stock' }
}
