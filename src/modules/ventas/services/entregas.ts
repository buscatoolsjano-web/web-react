import { supabase } from '@/services/supabase/client'
import { registrarEvento } from './auditoria'

/**
 * Entregas / remitos.
 *
 * El circuito es el del legacy —pedido → elegir cantidades → remito— pero sin
 * lo que lo hacía frágil: no hay `entregado[idx]`, cada línea de entrega
 * apunta a su `sales_order_line_id`, y el stock lo mueve una función atómica
 * del servidor, no el navegador.
 */

export interface LineaParaEntregar {
  orderLineId: string
  productId: string | null
  sku: string | null
  nombre: string | null
  descripcion: string | null
  pedida: number
  entregada: number
  pendiente: number
  precioUnitario: number
  descuentoPct: number
  tratamientoImpuesto: string
  tasaImpuesto: number
  /** Libre en el depósito. `null` si el producto no tiene saldo registrado. */
  stockLibre: number | null
}

/**
 * Qué queda por entregar de un pedido, línea por línea.
 *
 * `entregada` suma TODAS las entregas no canceladas —incluidas las que están
 * en borrador—: una entrega sin confirmar ya reservó esa cantidad del pedido,
 * y ofrecerla dos veces sería prometer de más.
 */
export async function lineasParaEntregar(
  companyId: string,
  orderId: string,
): Promise<LineaParaEntregar[]> {
  const { data: lineas, error } = await supabase
    .from('sales_order_lines')
    .select(
      `id, line_no, line_type, product_id, sku_snapshot, name_snapshot,
       description_snapshot, quantity_ordered, unit_price, discount_pct,
       tax_treatment, tax_rate_snapshot`,
    )
    .eq('company_id', companyId)
    .eq('order_id', orderId)
    .order('line_no')
  if (error) throw new Error(`No se pudieron leer las líneas: ${error.message}`)

  const items = (lineas ?? []).filter((l) => l.line_type !== 'chapter')
  if (items.length === 0) return []

  // Lo ya entregado, de todas las entregas no canceladas del pedido.
  const { data: entregas } = await supabase
    .from('deliveries')
    .select('id')
    .eq('company_id', companyId)
    .eq('order_id', orderId)
    .neq('status', 'cancelled')

  const entregadoPorLinea = new Map<string, number>()
  const ids = (entregas ?? []).map((e) => e.id)
  if (ids.length > 0) {
    const { data: dl } = await supabase
      .from('delivery_lines')
      .select('order_line_id, quantity')
      .eq('company_id', companyId)
      .in('delivery_id', ids)
    for (const l of dl ?? []) {
      if (!l.order_line_id) continue
      entregadoPorLinea.set(
        l.order_line_id,
        (entregadoPorLinea.get(l.order_line_id) ?? 0) + Number(l.quantity),
      )
    }
  }

  // Stock libre, sólo para roles internos: si RLS lo bloquea vuelve vacío y
  // la columna se muestra como «sin dato», no como cero.
  const productIds = items.flatMap((l) => (l.product_id ? [l.product_id] : []))
  const stock = new Map<string, number>()
  if (productIds.length > 0) {
    const { data: saldos } = await supabase
      .from('stock_balances')
      .select('product_id, on_hand, reserved')
      .eq('company_id', companyId)
      .in('product_id', productIds)
    for (const s of saldos ?? []) {
      const libre = Number(s.on_hand) - Number(s.reserved)
      stock.set(s.product_id, (stock.get(s.product_id) ?? 0) + libre)
    }
  }

  return items.map((l) => {
    const pedida = Number(l.quantity_ordered)
    const entregada = entregadoPorLinea.get(l.id) ?? 0
    return {
      orderLineId: l.id,
      productId: l.product_id,
      sku: l.sku_snapshot,
      nombre: l.name_snapshot,
      descripcion: l.description_snapshot,
      pedida,
      entregada,
      pendiente: Math.max(0, pedida - entregada),
      precioUnitario: Number(l.unit_price),
      descuentoPct: Number(l.discount_pct ?? 0),
      tratamientoImpuesto: l.tax_treatment ?? 'vat_21',
      tasaImpuesto: Number(l.tax_rate_snapshot ?? 0),
      stockLibre: l.product_id ? (stock.get(l.product_id) ?? null) : null,
    }
  })
}

/**
 * Crea el remito con las cantidades elegidas.
 *
 * Nace en `draft`: **no mueve stock**. El stock se descuenta al confirmar, en
 * una sola operación atómica del servidor.
 *
 * La serie es siempre `RT`. `RT-ML` existe en el modelo y en los cuatro
 * remitos históricos, pero no tiene secuencia sembrada: pedirla devolvería
 * `no_data_found`. Por eso no se ofrece como opción.
 */
export async function crearEntregaDesdePedido(
  companyId: string,
  orderId: string,
  cantidades: Map<string, number>,
  lineas: readonly LineaParaEntregar[],
  fecha: string,
): Promise<string> {
  const aEntregar = lineas.filter((l) => (cantidades.get(l.orderLineId) ?? 0) > 0)
  if (aEntregar.length === 0) throw new Error('No hay ninguna cantidad para entregar.')

  const excedida = aEntregar.find((l) => (cantidades.get(l.orderLineId) ?? 0) > l.pendiente)
  if (excedida) {
    throw new Error(
      `${excedida.sku ?? 'Una línea'} tiene ${excedida.pendiente} pendiente y se quiso entregar ${
        cantidades.get(excedida.orderLineId) ?? 0
      }.`,
    )
  }

  const { data: pedido, error: eP } = await supabase
    .from('sales_orders')
    .select('customer_id, contact_id, title, currency_code, exchange_rate, notes')
    .eq('company_id', companyId)
    .eq('id', orderId)
    .single()
  if (eP) throw new Error(`No se pudo leer el pedido: ${eP.message}`)

  const { data: deposito, error: eD } = await supabase
    .from('warehouses')
    .select('id')
    .eq('company_id', companyId)
    .limit(1)
    .single()
  if (eD) throw new Error(`No hay depósito configurado: ${eD.message}`)

  const { data: numero, error: eN } = await supabase.rpc('next_document_number', {
    p_company: companyId,
    p_doc_type: 'delivery',
  })
  if (eN) throw new Error(`No se pudo obtener el número: ${eN.message}`)
  if (!numero) throw new Error('La numeración no devolvió ningún número')

  const { data: entrega, error } = await supabase
    .from('deliveries')
    .insert({
      company_id: companyId,
      number: numero,
      series_code: 'RT',
      order_id: orderId,
      customer_id: pedido.customer_id,
      contact_id: pedido.contact_id,
      title: pedido.title,
      delivery_date: fecha,
      currency_code: pedido.currency_code,
      exchange_rate: pedido.exchange_rate,
      status: 'draft',
    })
    .select('id')
    .single()
  if (error) throw new Error(`No se pudo crear el remito: ${error.message}`)

  // El snapshot se copia de la línea del pedido, no del catálogo: el precio
  // que vale es el que se acordó, no el de hoy.
  const { error: eL } = await supabase.from('delivery_lines').insert(
    aEntregar.map((l) => ({
      company_id: companyId,
      delivery_id: entrega.id,
      order_line_id: l.orderLineId,
      product_id: l.productId,
      sku_snapshot: l.sku,
      name_snapshot: l.nombre,
      quantity: cantidades.get(l.orderLineId)!,
      warehouse_id: deposito.id,
      unit_price: l.precioUnitario,
      discount_pct: l.descuentoPct,
      tax_treatment: l.tratamientoImpuesto,
      tax_rate_snapshot: l.tasaImpuesto,
    })),
  )
  if (eL) {
    // La línea la rechazó un trigger (por ejemplo, sobreentrega): el remito
    // vacío no puede quedar dando vueltas.
    await supabase.from('deliveries').delete().eq('id', entrega.id)
    throw new Error(eL.message)
  }

  await registrarEvento('delivery', entrega.id, 'created', null, 'draft', null)
  return entrega.id
}

export interface ResultadoConfirmacion {
  yaConfirmada: boolean
  status: string
  movimientos: number
  reservasLiberadas: number
  cumplimiento?: string
}

/**
 * Confirma el remito: descuenta stock, libera reservas y actualiza el pedido.
 *
 * Todo pasa dentro de `public.confirmar_entrega`, en una transacción y con la
 * fila del remito bloqueada. Es idempotente: un doble click, un reintento
 * después de refrescar o dos pestañas confirmando a la vez generan **un solo**
 * movimiento de stock.
 */
export async function confirmarEntrega(deliveryId: string): Promise<ResultadoConfirmacion> {
  const { data, error } = await supabase.rpc('confirmar_entrega', { p_delivery: deliveryId })
  if (error) throw new Error(`No se pudo confirmar: ${error.message}`)

  const r = data as {
    ya_confirmada: boolean
    status: string
    movimientos: number
    reservas_liberadas: number
    cumplimiento?: string
  }
  return {
    yaConfirmada: r.ya_confirmada,
    status: r.status,
    movimientos: r.movimientos,
    reservasLiberadas: r.reservas_liberadas,
    ...(r.cumplimiento !== undefined && { cumplimiento: r.cumplimiento }),
  }
}

/** Qué se puede hacer con un remito según su estado. */
export function editabilidadEntrega(
  estado: string,
  esInterno: boolean,
): { confirmable: boolean; motivo: string | null } {
  if (!esInterno) return { confirmable: false, motivo: 'Sólo el equipo interno despacha remitos.' }
  if (estado === 'draft') return { confirmable: true, motivo: null }
  if (estado === 'cancelled') return { confirmable: false, motivo: 'El remito está cancelado.' }
  return { confirmable: false, motivo: 'El remito ya fue despachado.' }
}
