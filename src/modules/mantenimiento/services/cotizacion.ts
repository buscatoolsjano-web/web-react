import { supabase } from '@/services/supabase/client'
import type { DatosLinea, LineaCotizacion } from '../types'

/**
 * La cotización de una orden de mantenimiento.
 *
 * No hay tabla de cabecera: la cotización **es** la orden. Sus totales, su
 * estado y su moneda son columnas de `maintenance_orders`, y las líneas viven
 * en `maintenance_quote_lines`. No se reutiliza `sales_quotes`: una cotización
 * de servicio no tiene cliente propio ni numeración propia ni impuestos.
 *
 * Tres reglas que impone el servidor y acá no se deciden:
 *
 *   1. **El total lo calcula la base.** `line_total` y `quote_total` se
 *      recalculan por trigger; lo que mande el navegador se ignora. Lo que
 *      se muestra mientras se escribe es una vista previa.
 *   2. **Una línea con importe exige moneda.** Un total numérico sin moneda no
 *      significa nada.
 *   3. **Aprobar y rechazar son RPC.** `approved` y `rejected` son estados
 *      finales y por un UPDATE suelto no se pasa.
 */

const COLUMNAS = 'id, line_no, line_type, product_id, sku_snapshot, description_snapshot, quantity, unit_price, line_total'

interface Fila {
  id: string
  line_no: number
  line_type: string
  product_id: string | null
  sku_snapshot: string | null
  description_snapshot: string | null
  quantity: number | string
  unit_price: number | string
  line_total: number | string
}

const aNumero = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

const vacioANulo = (s: string): string | null => {
  const t = s.trim()
  return t === '' ? null : t
}

const aLinea = (f: Fila): LineaCotizacion => ({
  id: f.id,
  posicion: f.line_no,
  tipo: f.line_type as LineaCotizacion['tipo'],
  productoId: f.product_id,
  sku: f.sku_snapshot,
  descripcion: f.description_snapshot,
  cantidad: aNumero(f.quantity),
  precioUnitario: aNumero(f.unit_price),
  total: aNumero(f.line_total),
})

export async function lineasDeCotizacion(
  companyId: string,
  ordenId: string,
): Promise<LineaCotizacion[]> {
  const { data, error } = await supabase
    .from('maintenance_quote_lines')
    .select(COLUMNAS)
    .eq('company_id', companyId)
    .eq('maintenance_order_id', ordenId)
    .order('line_no', { ascending: true })
  if (error) throw new Error(`No se pudieron leer las líneas: ${error.message}`)
  return ((data ?? []) as unknown as Fila[]).map(aLinea)
}

function fila(d: DatosLinea) {
  return {
    line_no: d.posicion,
    line_type: d.tipo,
    product_id: d.productoId,
    sku_snapshot: d.sku,
    description_snapshot: vacioANulo(d.descripcion),
    quantity: d.cantidad,
    unit_price: d.precioUnitario,
  }
}

export async function crearLinea(
  companyId: string,
  ordenId: string,
  d: DatosLinea,
): Promise<LineaCotizacion> {
  const { data, error } = await supabase
    .from('maintenance_quote_lines')
    .insert({ company_id: companyId, maintenance_order_id: ordenId, ...fila(d) })
    .select(COLUMNAS)
    .single()
  if (error) throw new Error(traducir(error.message, error.code))
  return aLinea(data)
}

export async function actualizarLinea(
  companyId: string,
  id: string,
  d: DatosLinea,
): Promise<void> {
  const { error } = await supabase
    .from('maintenance_quote_lines')
    .update(fila(d))
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

export async function borrarLinea(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('maintenance_quote_lines')
    .delete()
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

/**
 * Mover una línea arriba o abajo.
 *
 * `line_no` es único por orden, así que intercambiar dos posiciones de frente
 * choca con el índice. El paso intermedio va por un número libre —el máximo de
 * la orden más uno— y no por uno negativo, que el CHECK `line_no > 0`
 * rechazaría.
 */
export async function intercambiarPosicion(
  companyId: string,
  ordenId: string,
  a: LineaCotizacion,
  b: LineaCotizacion,
): Promise<void> {
  const { data: todas, error: eL } = await supabase
    .from('maintenance_quote_lines')
    .select('line_no')
    .eq('company_id', companyId)
    .eq('maintenance_order_id', ordenId)
  if (eL) throw new Error(`No se pudo reordenar: ${eL.message}`)
  const libre = Math.max(0, ...(todas ?? []).map((x) => x.line_no)) + 1

  const paso = async (id: string, posicion: number) => {
    const { error } = await supabase
      .from('maintenance_quote_lines')
      .update({ line_no: posicion })
      .eq('company_id', companyId)
      .eq('id', id)
    if (error) throw new Error(traducir(error.message, error.code))
  }

  await paso(a.id, libre)
  await paso(b.id, a.posicion)
  await paso(a.id, b.posicion)
}

/**
 * La moneda de la cotización.
 *
 * Se puede elegir y cambiar mientras la cotización esté pendiente. Cambiarla
 * **no convierte ningún importe**: los números son los que cargó la persona y
 * no existe ningún tipo de cambio en la base que permita convertirlos sin
 * inventarlo.
 */
export async function elegirMoneda(
  companyId: string,
  ordenId: string,
  moneda: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('maintenance_orders')
    .update({ quote_currency_code: moneda })
    .eq('company_id', companyId)
    .eq('id', ordenId)
  if (error) throw new Error(traducir(error.message, error.code))
}

/** Aprobar. `p_por` es la persona DEL CLIENTE que dio el visto bueno. */
export async function aprobarCotizacion(
  ordenId: string,
  por: string,
): Promise<{ yaEstaba: boolean }> {
  const { data, error } = await supabase.rpc('aprobar_cotizacion_mantenimiento', {
    p_order: ordenId,
    p_por: vacioANulo(por),
  })
  if (error) throw new Error(traducir(error.message, error.code))
  return { yaEstaba: (data as unknown as { ya_estaba: boolean }).ya_estaba }
}

export async function rechazarCotizacion(
  ordenId: string,
  motivo: string,
): Promise<{ yaEstaba: boolean }> {
  const { data, error } = await supabase.rpc('rechazar_cotizacion_mantenimiento', {
    p_order: ordenId,
    p_motivo: vacioANulo(motivo),
  })
  if (error) throw new Error(traducir(error.message, error.code))
  return { yaEstaba: (data as unknown as { ya_estaba: boolean }).ya_estaba }
}

/** El error de Postgres, en castellano. */
function traducir(mensaje: string, codigo?: string): string {
  if (codigo === '23505' && mensaje.includes('line_no')) {
    return 'Ya hay otra línea en esa posición.'
  }
  if (codigo === '42501') {
    return 'No tenés permiso para hacer este cambio. Mantenimiento es de administradores y empleados.'
  }
  // Los mensajes de los triggers ya están escritos para leerse.
  if (codigo === '23001' || codigo === '23514') return mensaje
  return mensaje
}
