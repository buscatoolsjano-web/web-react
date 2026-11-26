import { supabase } from '@/services/supabase/client'

export interface DisponibilidadProducto {
  /** Suma de todos los depósitos de la empresa. */
  enStock: number
  reservado: number
  /** Lo que queda libre: `enStock − reservado`, nunca negativo. */
  libre: number
}

/**
 * Disponibilidad de los productos de un pedido.
 *
 * Sólo para roles internos: `stock_balances` no es legible por un cliente
 * externo, y no por decisión de esta consulta sino por RLS. Si un externo la
 * llama igual, recibe cero filas y la pantalla muestra «sin datos», no un
 * error.
 *
 * **Esto no reserva nada.** Crear un pedido no toca el stock: la reserva es
 * una acción explícita del diseño aprobado y todavía no está implementada.
 * Acá sólo se lee.
 */
export async function disponibilidadDeProductos(
  companyId: string,
  productIds: readonly string[],
): Promise<Map<string, DisponibilidadProducto>> {
  const ids = [...new Set(productIds)]
  if (ids.length === 0) return new Map()

  const { data, error } = await supabase
    .from('stock_balances')
    .select('product_id, on_hand, reserved')
    .eq('company_id', companyId)
    .in('product_id', ids)
  if (error) throw new Error(`No se pudo leer el stock: ${error.message}`)

  const mapa = new Map<string, DisponibilidadProducto>()
  for (const f of (data ?? []) as { product_id: string; on_hand: number; reserved: number }[]) {
    const previo = mapa.get(f.product_id) ?? { enStock: 0, reservado: 0, libre: 0 }
    // Un producto puede tener saldo en más de un depósito: se suman.
    const enStock = previo.enStock + Number(f.on_hand)
    const reservado = previo.reservado + Number(f.reserved)
    mapa.set(f.product_id, {
      enStock,
      reservado,
      libre: Math.max(0, enStock - reservado),
    })
  }
  return mapa
}

/** Faltante de una línea: lo pedido menos lo libre. 0 si alcanza. */
export function faltante(cantidadPedida: number, d: DisponibilidadProducto | undefined): number {
  if (!d) return 0
  return Math.max(0, cantidadPedida - d.libre)
}

export interface EnCaminoProducto {
  cantidad: number
  /** La llegada estimada más próxima, si algún pedido la tiene. */
  llegada: string | null
}

/**
 * Lo pedido a proveedores y todavía no recibido del todo, por producto
 * (2026-11, plazo de entrega). Pedidos de compra confirmados con recepción
 * pendiente o parcial. Es la cantidad pedida, no lo que falta recibir línea
 * por línea: alcanza para decir «viene en camino» y cuándo.
 */
function haceDias(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toLocaleDateString('sv-SE')
}

export async function enCaminoDeProductos(
  companyId: string,
  productIds: readonly string[],
): Promise<Map<string, EnCaminoProducto>> {
  const ids = [...new Set(productIds)]
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase
    .from('purchase_order_lines')
    .select('product_id, quantity, purchase_orders!inner ( status, receipt_status, expected_date, order_date )')
    .eq('company_id', companyId)
    .in('product_id', ids)
    .eq('purchase_orders.status', 'confirmed')
    .in('purchase_orders.receipt_status', ['pending', 'partially_received'])
    // Sólo lo reciente (2026-11): Torquetools trae de STEL cientos de pedidos
    // viejos «sin recibir» —desde 2019— que en realidad llegaron hace años.
    // Cuenta lo pedido en los últimos 6 meses, o lo que tiene llegada cargada
    // desde hace un mes en adelante.
    .or(`order_date.gte.${haceDias(180)},expected_date.gte.${haceDias(30)}`, { referencedTable: 'purchase_orders' })
  if (error) throw new Error(`No se pudo leer lo pedido a proveedores: ${error.message}`)

  const mapa = new Map<string, EnCaminoProducto>()
  type Fila = { product_id: string | null; quantity: number; purchase_orders: { expected_date: string | null } | null }
  for (const f of (data ?? []) as unknown as Fila[]) {
    if (!f.product_id) continue
    const previo = mapa.get(f.product_id) ?? { cantidad: 0, llegada: null }
    const llegada = f.purchase_orders?.expected_date ?? null
    mapa.set(f.product_id, {
      cantidad: previo.cantidad + Number(f.quantity),
      llegada: llegada && (!previo.llegada || llegada < previo.llegada) ? llegada : previo.llegada,
    })
  }
  return mapa
}
