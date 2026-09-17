import { supabase } from '@/services/supabase/client'
import type { Json } from '@/types/database.types'
import { FalloDeGuardado } from './cotizaciones'

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

/** Los motivos de la base, en castellano y sin jerga. */
export const MOTIVOS_REMITO: Record<string, string> = {
  CONFLICTO_DE_EDICION:
    'Alguien más guardó este remito mientras lo editabas. Recargá para ver los cambios; lo tuyo no se perdió.',
  PEDIDO_TOTALMENTE_ENTREGADO: 'Este pedido ya está entregado por completo: no queda nada pendiente.',
  PEDIDO_NO_CONFIRMADO: 'El pedido todavía no está confirmado: primero confirmalo.',
  PEDIDO_CANCELADO: 'El pedido está cancelado.',
  PEDIDO_INEXISTENTE: 'No encontramos el pedido.',
  SOBREENTREGA: 'Se quiso entregar más de lo que queda pendiente.',
  CANTIDAD_INVALIDA: 'Las cantidades tienen que ser mayores que cero.',
  LINEA_DE_OTRO_PEDIDO: 'Una línea no pertenece a este pedido.',
  LINEA_DE_OTRO_REMITO: 'Una línea no pertenece a este remito.',
  LINEA_SIN_PEDIDO: 'Una línea no dice de qué línea del pedido sale.',
  LINEA_CON_SERIES: 'Esa línea tiene números de serie cargados: primero hay que quitarlos.',
  LINEA_FACTURADA: 'Esa línea ya está facturada y no se modifica.',
  SIN_LINEAS: 'Un remito sin líneas no es un remito.',
  SIN_DEPOSITO: 'La empresa no tiene ningún depósito configurado.',
  SIN_SERIE: 'La empresa no tiene una serie de numeración para remitos.',
  REMITO_DESPACHADO: 'El remito ya fue despachado: movió stock y no se modifica.',
  REMITO_CANCELADO: 'El remito está cancelado.',
  REMITO_HISTORICO: 'Es un remito migrado del sistema anterior: no se edita.',
  REMITO_INEXISTENTE: 'No encontramos el remito.',
  CAMPO_NO_EDITABLE: 'Se intentó cambiar un campo que no se edita.',
  CONTACTO_DE_OTRO_CLIENTE: 'Ese contacto es de otro cliente.',
  SIN_PERMISO_EMPRESA: 'Tu rol no emite ni edita remitos.',
  external_numbering_authority:
    'La numeración de remitos todavía la administra STEL: no se puede emitir desde el ERP.',
}

function falloDeRemito(mensaje: string, porDefecto: string): FalloDeGuardado {
  const codigo = Object.keys(MOTIVOS_REMITO).find((c) => mensaje.includes(c))
  return new FalloDeGuardado(codigo ?? 'error_interno', codigo ? MOTIVOS_REMITO[codigo]! : porDefecto)
}

export interface RemitoCreado {
  id: string
  numero: string
  lineas: number
}

/**
 * Crea el remito con las cantidades elegidas (Fase 15 · E5).
 *
 * Una sola llamada: `crear_remito_desde_pedido` bloquea el pedido, recalcula
 * el pendiente **en la base**, valida cantidad por cantidad, pide el número,
 * inserta cabecera y líneas con sus snapshots y lo audita. Antes eran cinco
 * viajes desde el navegador y, si una línea fallaba, el navegador borraba el
 * remito a mano.
 *
 * El lock del pedido es lo que impide la sobreentrega concurrente: dos
 * personas remitando el mismo pendiente se serializan y la segunda recibe un
 * motivo, no un remito de más.
 *
 * Nace en `draft`: **no mueve stock**. Eso pasa al despachar.
 */
export async function crearEntregaDesdePedido(
  orderId: string,
  cantidades: Map<string, number>,
  fecha: string,
  esperado: string | null = null,
): Promise<RemitoCreado> {
  const lineas = [...cantidades.entries()]
    .filter(([, cantidad]) => cantidad > 0)
    .map(([order_line_id, quantity]) => ({ order_line_id, quantity }))

  const { data, error } = await supabase.rpc('crear_remito_desde_pedido', {
    p_order: orderId,
    p_lineas: lineas,
    p_fecha: fecha,
    ...(esperado !== null && { p_esperado: esperado }),
  })
  if (error) throw falloDeRemito(error.message, 'No se pudo generar el remito.')

  const r = data as unknown as { id: string; number: string; lineas: number }
  return { id: r.id, numero: r.number, lineas: r.lineas }
}

export interface LineaRemitoGuardada {
  id?: string | null
  order_line_id?: string | null
  quantity: number
  description_snapshot?: string | null
}

export interface ResultadoGuardadoRemito {
  actualizadoEn: string
  cambiosCabecera: number
  lineasTocadas: number
}

/**
 * Guarda un remito EN BORRADOR: cabecera y líneas, en una transacción.
 *
 * Mismo contrato que `guardar_pedido`: whitelist de campos, testigo de
 * concurrencia y todo o nada. Un remito despachado no llega acá —la base lo
 * rechaza— porque ya movió stock.
 */
export async function guardarRemito(
  deliveryId: string,
  esperado: string,
  cabecera: Record<string, string | number | null>,
  lineas: readonly LineaRemitoGuardada[],
): Promise<ResultadoGuardadoRemito> {
  const { data, error } = await supabase.rpc('guardar_remito', {
    p_delivery: deliveryId,
    p_esperado: esperado,
    p_cabecera: cabecera,
    p_lineas: lineas as unknown as Json,
  })
  if (error) throw falloDeRemito(error.message, 'No se pudo guardar el remito.')

  const r = data as unknown as {
    actualizado_en: string
    cambios_cabecera: number
    lineas_tocadas: number
  }
  return {
    actualizadoEn: r.actualizado_en,
    cambiosCabecera: r.cambios_cabecera,
    lineasTocadas: r.lineas_tocadas,
  }
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

/**
 * Qué se puede hacer con un remito según su estado (Fase 15 · E5).
 *
 * El borrador se edita y se despacha. Lo despachado ya movió stock: ni se
 * edita ni se cancela, y eso lo impone la base, no la pantalla.
 */
export function editabilidadEntrega(
  estado: string,
  esInterno: boolean,
  esHistorico = false,
): { confirmable: boolean; editable: boolean; motivo: string | null } {
  if (!esInterno) {
    return {
      confirmable: false,
      editable: false,
      motivo: 'Tu rol no despacha remitos: es de administradores y empleados.',
    }
  }
  if (estado === 'cancelled') {
    return { confirmable: false, editable: false, motivo: 'El remito está cancelado.' }
  }
  if (estado !== 'draft') {
    return {
      confirmable: false,
      editable: false,
      motivo: 'El remito ya fue despachado: movió stock y no se modifica.',
    }
  }
  if (esHistorico) {
    return {
      confirmable: true,
      editable: false,
      motivo: 'Es un remito migrado del sistema anterior: se consulta, no se edita.',
    }
  }
  return { confirmable: true, editable: true, motivo: null }
}
