import { supabase } from '@/services/supabase/client'
import type { DatosRepuesto, Deposito, RepuestoDeOrden } from '../types'

/**
 * Los repuestos de una orden.
 *
 * **Un repuesto NO es una línea de cotización.** La cotización es lo que se le
 * ofrece al cliente; los repuestos son lo que efectivamente se usó en la
 * reparación. No hay ninguna FK entre las dos tablas y ninguna sincronización:
 * puede haber cotización sin repuestos, repuestos sin cotización, y los
 * importes pueden no tener nada que ver.
 *
 * Por la misma razón el costo **nunca** se completa desde una lista de
 * precios: esas listas son de VENTA. No hay ninguna fuente de costo confiable
 * en la base —ningún pedido de compra confirmado, ninguna recepción, ninguna
 * factura de proveedor, ninguna columna de costo en `products`—, así que el
 * costo es carga manual o queda nulo. Y si hay costo, hay moneda de costo: un
 * número sin unidad no es un costo.
 *
 * **Agregar un repuesto no mueve stock.** El stock se mueve una sola vez, al
 * confirmar el consumo, y por su RPC.
 */

const COLUMNAS = `
  id, product_id, sku_snapshot, name_snapshot, warehouse_id, quantity,
  unit_cost_snapshot, unit_cost_currency_code, consumed_at, stock_movement_id,
  deposito:warehouses!warehouse_id ( name )
`

interface Fila {
  id: string
  product_id: string
  sku_snapshot: string | null
  name_snapshot: string | null
  warehouse_id: string
  quantity: number | string
  unit_cost_snapshot: number | string | null
  unit_cost_currency_code: string | null
  consumed_at: string | null
  stock_movement_id: number | null
  deposito: { name: string } | null
}

const aNumero = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

const aRepuesto = (f: Fila): RepuestoDeOrden => ({
  id: f.id,
  productoId: f.product_id,
  sku: f.sku_snapshot,
  nombre: f.name_snapshot,
  depositoId: f.warehouse_id,
  deposito: f.deposito?.name ?? null,
  cantidad: aNumero(f.quantity),
  costoUnitario: f.unit_cost_snapshot === null ? null : aNumero(f.unit_cost_snapshot),
  monedaCosto: f.unit_cost_currency_code,
  consumidoEn: f.consumed_at,
  movimientoId: f.stock_movement_id,
  stockActual: null,
})

/**
 * Los repuestos, con el saldo actual de cada producto en su depósito.
 *
 * El saldo va en una segunda consulta acotada a los productos de esta orden:
 * son unos pocos, y así la pantalla puede mostrar «queda 2, se consumen 3» sin
 * traer la tabla de saldos entera.
 */
export async function repuestosDeOrden(
  companyId: string,
  ordenId: string,
): Promise<RepuestoDeOrden[]> {
  const { data, error } = await supabase
    .from('maintenance_order_parts')
    .select(COLUMNAS)
    .eq('company_id', companyId)
    .eq('maintenance_order_id', ordenId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`No se pudieron leer los repuestos: ${error.message}`)

  const filas = ((data ?? []) as unknown as Fila[]).map(aRepuesto)
  if (filas.length === 0) return filas

  const { data: saldos, error: eS } = await supabase
    .from('stock_balances')
    .select('product_id, warehouse_id, on_hand')
    .eq('company_id', companyId)
    .in('product_id', [...new Set(filas.map((f) => f.productoId))])
  if (eS) throw new Error(`No se pudo leer el stock: ${eS.message}`)

  // Un producto sin fila de saldo tiene cero, no «desconocido»: la fila se
  // crea recién con el primer movimiento.
  const porClave = new Map(
    (saldos ?? []).map((s) => [`${s.product_id}|${s.warehouse_id}`, aNumero(s.on_hand)]),
  )
  return filas.map((f) => ({
    ...f,
    stockActual: porClave.get(`${f.productoId}|${f.depositoId}`) ?? 0,
  }))
}

/** Los depósitos activos de la empresa. Nunca se hardcodea el principal. */
export async function depositosActivos(companyId: string): Promise<Deposito[]> {
  const { data, error } = await supabase
    .from('warehouses')
    .select('id, code, name, is_default')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('name')
  if (error) throw new Error(`No se pudieron leer los depósitos: ${error.message}`)
  return (data ?? []).map((d) => ({
    id: d.id,
    codigo: d.code,
    nombre: d.name,
    porDefecto: d.is_default,
  }))
}

function fila(d: DatosRepuesto) {
  return {
    product_id: d.productoId,
    sku_snapshot: d.sku,
    name_snapshot: d.nombre,
    warehouse_id: d.depositoId,
    quantity: d.cantidad,
    unit_cost_snapshot: d.costoUnitario,
    unit_cost_currency_code: d.costoUnitario === null ? null : d.monedaCosto,
  }
}

export async function agregarRepuesto(
  companyId: string,
  ordenId: string,
  d: DatosRepuesto,
): Promise<void> {
  const { error } = await supabase
    .from('maintenance_order_parts')
    .insert({ company_id: companyId, maintenance_order_id: ordenId, ...fila(d) })
  if (error) throw new Error(traducir(error.message, error.code))
}

export async function actualizarRepuesto(
  companyId: string,
  id: string,
  d: DatosRepuesto,
): Promise<void> {
  const { error } = await supabase
    .from('maintenance_order_parts')
    .update(fila(d))
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

export async function borrarRepuesto(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('maintenance_order_parts')
    .delete()
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

/**
 * Confirmar el consumo.
 *
 * Consume **todas** las líneas pendientes de la orden, de una vez y en una
 * sola transacción: o entran todas o no entra ninguna. Llamarla dos veces no
 * duplica nada, y dos pestañas a la vez tampoco: la orden queda bloqueada
 * mientras dura.
 *
 * El saldo puede quedar negativo y eso **no** la detiene. La reparación ya
 * ocurrió físicamente: negarse a registrarla haría que el sistema mienta sobre
 * una herramienta que ya tiene el repuesto puesto.
 */
export async function confirmarConsumo(
  ordenId: string,
): Promise<{ yaEstaba: boolean; lineas: number }> {
  const { data, error } = await supabase.rpc('confirmar_consumo_mantenimiento', {
    p_order: ordenId,
  })
  if (error) throw new Error(traducir(error.message, error.code))
  const r = data as unknown as { ya_estaba: boolean; lineas: number }
  return { yaEstaba: r.ya_estaba, lineas: r.lineas }
}

function traducir(mensaje: string, codigo?: string): string {
  if (codigo === '42501') {
    return 'No tenés permiso para hacer este cambio. Mantenimiento es de administradores y empleados.'
  }
  if (codigo === '23001' || codigo === '23514' || codigo === '23502') return mensaje
  return mensaje
}
