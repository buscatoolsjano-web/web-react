import { supabase } from '@/services/supabase/client'
import type { TablesUpdate } from '@/types/database.types'
import { registrarEvento, type Editabilidad } from './auditoria'
import type { LineaNueva } from './cotizaciones'

export type CambiosPedido = TablesUpdate<'sales_orders'>
export type CambiosLineaPedido = TablesUpdate<'sales_order_lines'>

/**
 * Escritura de pedidos.
 *
 * Mismas tres reglas que en cotizaciones: los totales los calcula un trigger,
 * el número sale de `next_document_number()` y quién puede escribir lo decide
 * RLS. Lo único que cambia son los nombres de las columnas —el pedido usa
 * `quantity_ordered` y `commercial_status`— y que un pedido con entregas
 * tiene las líneas congeladas.
 */

export interface CabeceraPedidoNueva {
  companyId: string
  customerId: string
  contactId: string | null
  titulo: string | null
  fecha: string
  moneda: string
  tipoCambio: number | null
  formaPago: string | null
  notas: string | null
  descuentoPct: number | null
  percepcionPct: number | null
  /** De dónde salió el pedido; `quote` cuando viene de una cotización. */
  origen: 'quote' | 'manual'
  quoteId: string | null
}

function filaLinea(companyId: string, orderId: string, lineNo: number, l: LineaNueva) {
  return {
    company_id: companyId,
    order_id: orderId,
    line_no: lineNo,
    line_type: l.tipoLinea,
    product_id: l.productId,
    sku_snapshot: l.sku,
    name_snapshot: l.nombre,
    description_snapshot: l.descripcion,
    // Un capítulo lleva 1 y precio 0: hay un `check (quantity_ordered <> 0)`
    // y el trigger de totales lo excluye por `line_type`.
    quantity_ordered: l.tipoLinea === 'chapter' ? 1 : l.cantidad,
    unit_price: l.tipoLinea === 'chapter' ? 0 : l.precioUnitario,
    list_price_snapshot: l.precioLista,
    discount_pct: l.tipoLinea === 'chapter' ? 0 : l.descuentoPct,
    tax_treatment: l.tipoLinea === 'chapter' ? 'not_taxed' : l.tratamientoImpuesto,
    tax_rate_snapshot: l.tipoLinea === 'chapter' ? 0 : l.tasaImpuesto,
  }
}

async function proximoNumero(companyId: string): Promise<string> {
  const { data, error } = await supabase.rpc('next_document_number', {
    p_company: companyId,
    p_doc_type: 'sales_order',
  })
  if (error) throw new Error(`No se pudo obtener el número: ${error.message}`)
  if (!data) throw new Error('La numeración no devolvió ningún número')
  return data
}

export async function crearPedido(
  cab: CabeceraPedidoNueva,
  lineas: readonly LineaNueva[],
): Promise<string> {
  const numero = await proximoNumero(cab.companyId)

  const { data, error } = await supabase
    .from('sales_orders')
    .insert({
      company_id: cab.companyId,
      number: numero,
      series_code: 'PDV',
      customer_id: cab.customerId,
      contact_id: cab.contactId,
      quote_id: cab.quoteId,
      origin: cab.origen,
      title: cab.titulo,
      order_date: cab.fecha,
      currency_code: cab.moneda,
      exchange_rate: cab.tipoCambio,
      payment_terms: cab.formaPago,
      notes: cab.notas,
      discount_pct: cab.descuentoPct,
      perception_pct: cab.percepcionPct,
      commercial_status: 'draft',
    })
    .select('id')
    .single()
  if (error) {
    // El índice único sobre (company_id, quote_id) es lo que impide convertir
    // dos veces la misma cotización. Se traduce a algo legible.
    if (error.code === '23505' && error.message.includes('uq_sales_orders_quote')) {
      throw new Error('Esa cotización ya tiene un pedido.')
    }
    throw new Error(`No se pudo crear el pedido: ${error.message}`)
  }

  if (lineas.length > 0) {
    const { error: eL } = await supabase
      .from('sales_order_lines')
      .insert(lineas.map((l, i) => filaLinea(cab.companyId, data.id, i + 1, l)))
    if (eL) throw new Error(`No se pudieron guardar las líneas: ${eL.message}`)
  }

  await registrarEvento('sales_order', data.id, 'created', null, 'draft', null)
  return data.id
}

/**
 * Cotización → pedido.
 *
 * Copia los snapshots de la cotización tal como están y enlaza por
 * `quote_id`. **La cotización original no se toca**: no cambia de estado, no
 * se marca, no se modifica. Si además hay que darla por aceptada, eso es una
 * acción aparte que la persona decide.
 *
 * El vínculo es una clave foránea, no el texto del número: el legacy guardaba
 * `fromCotizacion: 'COTI02520'` como string y por eso Stage 2 tuvo que
 * reconstruir 132 relaciones a mano.
 */
export async function convertirCotizacionEnPedido(
  companyId: string,
  quoteId: string,
): Promise<string> {
  const { data: cot, error } = await supabase
    .from('sales_quotes')
    .select(
      `id, customer_id, contact_id, title, currency_code, exchange_rate,
       payment_terms, notes, discount_pct, perception_pct, status`,
    )
    .eq('company_id', companyId)
    .eq('id', quoteId)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer la cotización: ${error.message}`)
  if (!cot) throw new Error('La cotización no existe o no tenés acceso.')
  if (cot.status === 'rejected') throw new Error('Una cotización rechazada no se convierte.')

  const { data: lineas, error: eL } = await supabase
    .from('sales_quote_lines')
    .select(
      `line_no, line_type, product_id, sku_snapshot, name_snapshot,
       description_snapshot, quantity, unit_price, list_price_snapshot,
       discount_pct, tax_treatment, tax_rate_snapshot`,
    )
    .eq('company_id', companyId)
    .eq('quote_id', quoteId)
    .order('line_no')
  if (eL) throw new Error(`No se pudieron leer las líneas: ${eL.message}`)

  const hoy = new Date().toISOString().slice(0, 10)
  return crearPedido(
    {
      companyId,
      customerId: cot.customer_id,
      contactId: cot.contact_id,
      titulo: cot.title,
      fecha: hoy,
      moneda: cot.currency_code ?? 'USD',
      tipoCambio: cot.exchange_rate === null ? null : Number(cot.exchange_rate),
      formaPago: cot.payment_terms,
      notas: cot.notes,
      descuentoPct: cot.discount_pct === null ? null : Number(cot.discount_pct),
      percepcionPct: cot.perception_pct === null ? null : Number(cot.perception_pct),
      origen: 'quote',
      quoteId,
    },
    (lineas ?? []).map((l) => ({
      tipoLinea: l.line_type as LineaNueva['tipoLinea'],
      productId: l.product_id,
      sku: l.sku_snapshot,
      nombre: l.name_snapshot,
      descripcion: l.description_snapshot,
      marca: null,
      cantidad: Number(l.quantity),
      precioUnitario: Number(l.unit_price),
      precioLista: l.list_price_snapshot === null ? null : Number(l.list_price_snapshot),
      descuentoPct: Number(l.discount_pct ?? 0),
      tratamientoImpuesto: l.tax_treatment ?? 'vat_21',
      tasaImpuesto: Number(l.tax_rate_snapshot ?? 0),
    })),
  )
}

export async function actualizarCabeceraPedido(
  orderId: string,
  cambios: CambiosPedido,
): Promise<void> {
  const { error } = await supabase.from('sales_orders').update(cambios).eq('id', orderId)
  if (error) throw new Error(`No se pudo guardar: ${error.message}`)
}

export async function agregarLineaPedido(
  companyId: string,
  orderId: string,
  lineNo: number,
  l: LineaNueva,
): Promise<void> {
  const { error } = await supabase
    .from('sales_order_lines')
    .insert(filaLinea(companyId, orderId, lineNo, l))
  if (error) throw new Error(`No se pudo agregar la línea: ${error.message}`)
}

export async function actualizarLineaPedido(
  lineaId: string,
  cambios: CambiosLineaPedido,
): Promise<void> {
  const { error } = await supabase.from('sales_order_lines').update(cambios).eq('id', lineaId)
  if (error) throw new Error(`No se pudo guardar la línea: ${error.message}`)
}

export async function eliminarLineaPedido(lineaId: string): Promise<void> {
  const { error } = await supabase.from('sales_order_lines').delete().eq('id', lineaId)
  if (error) throw new Error(`No se pudo borrar la línea: ${error.message}`)
}

/** Ver el comentario de `intercambiarOrden` en cotizaciones.ts. */
export async function intercambiarOrdenPedido(
  a: { id: string; numeroLinea: number },
  b: { id: string; numeroLinea: number },
): Promise<void> {
  const provisorio = Math.max(a.numeroLinea, b.numeroLinea) + 1000
  await actualizarLineaPedido(a.id, { line_no: provisorio })
  await actualizarLineaPedido(b.id, { line_no: a.numeroLinea })
  await actualizarLineaPedido(a.id, { line_no: b.numeroLinea })
}

export async function cambiarEstadoPedido(
  orderId: string,
  desde: string,
  hasta: string,
): Promise<void> {
  const { error } = await supabase
    .from('sales_orders')
    .update({ commercial_status: hasta })
    .eq('id', orderId)
  if (error) throw new Error(`No se pudo cambiar el estado: ${error.message}`)

  await registrarEvento(
    'sales_order',
    orderId,
    hasta === 'cancelled' ? 'cancelled' : 'approved',
    desde,
    hasta,
    null,
  )
}

/**
 * Qué se puede editar de un pedido.
 *
 * `confirmed` con entregas tiene las líneas congeladas, y no por gusto:
 * cambiar la cantidad pedida de una línea ya entregada mueve el pendiente de
 * un documento que el cliente ya firmó. Es el mismo dato que Stage 2.5 tuvo
 * que reconstruir para 505 líneas.
 */
export function editabilidadPedido(
  estado: string,
  esInterno: boolean,
  tieneEntregas: boolean,
): Editabilidad {
  if (!esInterno) {
    return { editable: false, motivo: 'Sólo el equipo interno edita pedidos.', audita: false }
  }
  if (estado === 'cancelled') {
    return { editable: false, motivo: 'El pedido está cancelado.', audita: false }
  }
  if (tieneEntregas) {
    return {
      editable: false,
      motivo: 'El pedido ya tiene entregas: sus líneas no se modifican.',
      audita: false,
    }
  }
  if (estado === 'draft') return { editable: true, motivo: null, audita: false }
  return {
    editable: true,
    motivo: 'Ya está confirmado: los cambios de precio quedan registrados.',
    audita: true,
  }
}
