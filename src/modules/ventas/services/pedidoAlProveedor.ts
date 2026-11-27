import { supabase } from '@/services/supabase/client'

/**
 * Del distribuidor al proveedor (2026-11-27) — Fase 4.
 *
 * Desde una cotización ACEPTADA, el distribuidor le pide la mercadería a su
 * proveedor: la base crea allá un pedido en borrador a su precio de
 * distribuidor (`distribuidor_pedir_al_proveedor`). Él sólo ve el número y el
 * estado (`distribuidor_pedido_de_cotizacion`), nunca el pedido del proveedor.
 */

export interface PedidoAlProveedor {
  numero: string
  proveedor: string
  /** draft | confirmed | cancelled */
  estado: string
  /** pending | partially_reserved | reserved | partially_delivered | delivered */
  entrega: string | null
  pedidoEl: string
}

export interface ResultadoPedido {
  numero: string
  lineas: number
  omitidas: number
}

export async function pedidoDeCotizacion(quoteId: string): Promise<PedidoAlProveedor | null> {
  const { data, error } = await supabase.rpc('distribuidor_pedido_de_cotizacion', { p_quote: quoteId })
  if (error) throw new Error(`No se pudo leer el pedido al proveedor: ${error.message}`)
  return (data as PedidoAlProveedor | null) ?? null
}

const MENSAJES: Record<string, string> = {
  cotizacion_no_aceptada: 'Primero marcá la cotización como aceptada.',
  ya_pedida: 'Esta cotización ya se le pidió al proveedor.',
  sin_proveedor: 'Tu empresa no tiene un proveedor con catálogo compartido.',
  sin_productos_del_proveedor: 'La cotización no tiene productos del catálogo de tu proveedor.',
  sin_permiso: 'Tu rol no puede hacer pedidos al proveedor.',
}

export async function pedirAlProveedor(quoteId: string): Promise<ResultadoPedido> {
  const { data, error } = await supabase.rpc('distribuidor_pedir_al_proveedor', { p_quote: quoteId })
  if (error) {
    const codigo = Object.keys(MENSAJES).find((k) => error.message.includes(k))
    throw new Error(codigo ? MENSAJES[codigo] : 'No se pudo hacer el pedido. Intentá de nuevo.')
  }
  const r = data as { numero: string; lineas: number; omitidas: number }
  return { numero: r.numero, lineas: Number(r.lineas), omitidas: Number(r.omitidas) }
}

/** Cómo se lee el estado del pedido del lado del distribuidor. */
export function estadoDelPedido(p: PedidoAlProveedor): string {
  if (p.estado === 'cancelled') return 'cancelado'
  if (p.estado === 'draft') return 'recibido, a confirmar'
  if (p.entrega === 'delivered') return 'entregado'
  if (p.entrega === 'partially_delivered') return 'entregado en parte'
  return 'confirmado'
}
