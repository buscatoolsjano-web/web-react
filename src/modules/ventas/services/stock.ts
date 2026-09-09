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
