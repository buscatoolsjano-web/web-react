import { supabase } from '@/services/supabase/client'

/**
 * Disponibilidad para roles externos.
 *
 * `product_availability` es una vista con security_invoker = false y su
 * propio filtro por empresa: expone SÓLO un booleano, nunca la cantidad.
 * Un customer no puede saber si hay 2 o 2000 unidades.
 *
 * No se puede embeber en la consulta de productos: las vistas no tienen FK
 * declarada y PostgREST necesita una para inferir la relación. Por eso va
 * en su propio request, que se dispara únicamente para roles externos.
 *
 * Devuelve un Map product_id → disponible. Un producto SIN fila no está
 * disponible: 168 de 219 no tienen saldo de stock, así que la ausencia es
 * el caso normal, no un error.
 */
export async function obtenerDisponibilidad(
  companyId: string,
  productIds: readonly string[],
): Promise<Map<string, boolean>> {
  if (productIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('product_availability')
    .select('product_id, is_available')
    .eq('company_id', companyId)
    .in('product_id', [...productIds])

  if (error) throw new Error(`No se pudo leer la disponibilidad: ${error.message}`)

  // Varios depósitos: alcanza con que uno tenga stock.
  const mapa = new Map<string, boolean>()
  for (const fila of data ?? []) {
    if (!fila.product_id) continue
    const previo = mapa.get(fila.product_id) ?? false
    mapa.set(fila.product_id, previo || fila.is_available === true)
  }
  return mapa
}
