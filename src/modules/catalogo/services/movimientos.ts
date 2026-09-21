import { supabase } from '@/services/supabase/client'
import type { MovimientoDeStock } from '../types'

/**
 * El historial de stock de un producto. **Sólo lectura.**
 *
 * Se pide al abrir la sección, no al abrir el producto y muchísimo menos al
 * listar: cincuenta productos en pantalla serían cincuenta historiales que
 * nadie pidió.
 *
 * Los saldos resultantes se reconstruyen hacia atrás desde el saldo actual —
 * la tabla guarda el movimiento, no el saldo— y por eso hace falta traer el
 * saldo de hoy junto con los movimientos. Si no hay saldo (un rol externo no
 * lo ve), los movimientos se muestran igual y la columna de saldo queda
 * vacía: inventarla sería peor.
 */
export async function movimientosDeProducto(
  companyId: string,
  productId: string,
  limite = 15,
): Promise<{ movimientos: MovimientoDeStock[]; total: number }> {
  const { data, error, count } = await supabase
    .from('stock_movements')
    .select('id, created_at, movement_type, quantity, source_type, source_id, notes', {
      count: 'exact',
    })
    .eq('company_id', companyId)
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limite)

  if (error) throw new Error(`No se pudo leer el historial de stock: ${error.message}`)

  const filas = (data ?? []) as {
    id: number
    created_at: string
    movement_type: string
    quantity: number
    source_type: string | null
    source_id: string | null
    notes: string | null
  }[]

  return {
    movimientos: filas.map((f) => ({
      id: String(f.id),
      fecha: f.created_at,
      tipo: f.movement_type,
      cantidad: Number(f.quantity),
      origenTipo: f.source_type,
      origenId: f.source_id,
      notas: f.notes,
    })),
    total: count ?? filas.length,
  }
}
