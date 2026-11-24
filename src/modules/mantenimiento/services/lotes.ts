import { supabase } from '@/services/supabase/client'
import type { LineaCotizacion, TipoLineaCotizacion } from '../types'

/**
 * Cotización por lotes: varias órdenes de un mismo cliente en un solo
 * presupuesto. Todo lo que cambia un lote pasa por sus funciones de base
 * (`mant_lote_*`), que validan cliente, estado y moneda.
 */

export type EstadoLote = 'open' | 'approved' | 'rejected'

export interface LoteListado {
  id: string
  numero: string
  clienteId: string
  cliente: string
  estado: EstadoLote
  moneda: string | null
  equipos: number
  total: number
  creadoEn: string
}

export interface OrdenDeLote {
  id: string
  numero: string
  activoReferencia: string
  modelo: string | null
  serie: string | null
  estadoCotizacion: 'pending' | 'approved' | 'rejected'
  moneda: string | null
  total: number
  lineas: LineaCotizacion[]
}

export interface LoteDetalle extends LoteListado {
  notas: string | null
  aprobadoEn: string | null
  aprobadoPor: string | null
  pedidoVenta: { id: string; numero: string } | null
  ordenes: OrdenDeLote[]
}

/** Una orden que todavía puede entrar en un lote del cliente. */
export interface OrdenElegible {
  id: string
  numero: string
  activoReferencia: string
  modelo: string | null
  serie: string | null
  moneda: string | null
  total: number
  lineas: number
}

const aNumero = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}


/** El error de la base, legible: las funciones ya lo escriben en castellano. */
function traducir(mensaje: string, codigo?: string): string {
  if (codigo === '42501') return 'No tenés permiso para esto. Mantenimiento es de administradores y empleados.'
  return mensaje
}

interface FilaOrden {
  id: string
  number: string
  batch_id: string | null
  quote_status: string
  quote_currency_code: string | null
  quote_total: number | string
  equipo: { reference: string; model_text: string | null; serial_number: string | null } | null
}

export async function listarLotes(companyId: string): Promise<LoteListado[]> {
  const { data, error } = await supabase
    .from('maintenance_quote_batches')
    .select(
      `id, number, customer_id, status, currency_code, created_at,
       cliente:customers!customer_id ( legal_name ),
       ordenes:maintenance_orders!batch_id ( quote_total )`,
    )
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(`No se pudieron leer los lotes: ${error.message}`)
  return ((data ?? []) as unknown as {
    id: string
    number: string
    customer_id: string
    status: string
    currency_code: string | null
    created_at: string
    cliente: { legal_name: string } | null
    ordenes: { quote_total: number | string }[] | null
  }[]).map((l) => ({
    id: l.id,
    numero: l.number,
    clienteId: l.customer_id,
    cliente: l.cliente?.legal_name ?? '—',
    estado: l.status as EstadoLote,
    moneda: l.currency_code,
    equipos: l.ordenes?.length ?? 0,
    total: (l.ordenes ?? []).reduce((s, o) => s + aNumero(o.quote_total), 0),
    creadoEn: l.created_at,
  }))
}

export async function obtenerLote(companyId: string, id: string): Promise<LoteDetalle | null> {
  const { data, error } = await supabase
    .from('maintenance_quote_batches')
    .select(
      `id, number, customer_id, status, currency_code, notes, approved_at, approved_by_name, created_at,
       sales_order_id, pedido:sales_orders!sales_order_id ( number ),
       cliente:customers!customer_id ( legal_name )`,
    )
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el lote: ${error.message}`)
  if (!data) return null
  const l = data as unknown as {
    id: string
    number: string
    customer_id: string
    status: string
    currency_code: string | null
    notes: string | null
    approved_at: string | null
    approved_by_name: string | null
    created_at: string
    sales_order_id: string | null
    pedido: { number: string } | null
    cliente: { legal_name: string } | null
  }

  const { data: ords, error: e2 } = await supabase
    .from('maintenance_orders')
    .select(
      `id, number, batch_id, quote_status, quote_currency_code, quote_total,
       equipo:maintenance_assets!asset_id ( reference, model_text, serial_number )`,
    )
    .eq('company_id', companyId)
    .eq('batch_id', id)
    .order('number')
  if (e2) throw new Error(`No se pudieron leer las órdenes del lote: ${e2.message}`)
  const filas = (ords ?? []) as unknown as FilaOrden[]

  const ids = filas.map((o) => o.id)
  const lineas: Record<string, LineaCotizacion[]> = {}
  if (ids.length > 0) {
    const { data: ls, error: e3 } = await supabase
      .from('maintenance_quote_lines')
      .select('id, maintenance_order_id, line_no, line_type, product_id, sku_snapshot, description_snapshot, quantity, unit_price, line_total')
      .eq('company_id', companyId)
      .in('maintenance_order_id', ids)
      .order('line_no')
    if (e3) throw new Error(`No se pudieron leer las líneas del lote: ${e3.message}`)
    for (const x of ls ?? []) {
      ;(lineas[x.maintenance_order_id] ??= []).push({
        id: x.id,
        posicion: x.line_no,
        tipo: x.line_type as TipoLineaCotizacion,
        productoId: x.product_id,
        sku: x.sku_snapshot,
        descripcion: x.description_snapshot,
        cantidad: aNumero(x.quantity),
        precioUnitario: aNumero(x.unit_price),
        total: aNumero(x.line_total),
      })
    }
  }

  const ordenes: OrdenDeLote[] = filas.map((o) => ({
    id: o.id,
    numero: o.number,
    activoReferencia: o.equipo?.reference ?? '—',
    modelo: o.equipo?.model_text ?? null,
    serie: o.equipo?.serial_number ?? null,
    estadoCotizacion: o.quote_status as OrdenDeLote['estadoCotizacion'],
    moneda: o.quote_currency_code,
    total: aNumero(o.quote_total),
    lineas: lineas[o.id] ?? [],
  }))

  return {
    id: l.id,
    numero: l.number,
    clienteId: l.customer_id,
    cliente: l.cliente?.legal_name ?? '—',
    estado: l.status as EstadoLote,
    moneda: l.currency_code ?? ordenes[0]?.moneda ?? null,
    equipos: ordenes.length,
    total: ordenes.reduce((s, o) => s + o.total, 0),
    creadoEn: l.created_at,
    notas: l.notes,
    aprobadoEn: l.approved_at,
    aprobadoPor: l.approved_by_name,
    pedidoVenta: l.sales_order_id ? { id: l.sales_order_id, numero: l.pedido?.number ?? '—' } : null,
    ordenes,
  }
}

/** Las órdenes del cliente que pueden entrar en un lote: abiertas, cotización pendiente, sueltas. */
export async function ordenesElegibles(companyId: string, clienteId: string): Promise<OrdenElegible[]> {
  const { data, error } = await supabase
    .from('maintenance_orders')
    .select(
      `id, number, quote_currency_code, quote_total,
       equipo:maintenance_assets!asset_id ( reference, model_text, serial_number ),
       lineas:maintenance_quote_lines ( id )`,
    )
    .eq('company_id', companyId)
    .eq('customer_id', clienteId)
    .eq('status', 'open')
    .eq('quote_status', 'pending')
    .is('batch_id', null)
    .is('sales_order_id', null)
    .order('number')
  if (error) throw new Error(`No se pudieron leer las órdenes del cliente: ${error.message}`)
  return ((data ?? []) as unknown as {
    id: string
    number: string
    quote_currency_code: string | null
    quote_total: number | string
    equipo: { reference: string; model_text: string | null; serial_number: string | null } | null
    lineas: { id: string }[] | null
  }[]).map((o) => ({
    id: o.id,
    numero: o.number,
    activoReferencia: o.equipo?.reference ?? '—',
    modelo: o.equipo?.model_text ?? null,
    serie: o.equipo?.serial_number ?? null,
    moneda: o.quote_currency_code,
    total: aNumero(o.quote_total),
    lineas: o.lineas?.length ?? 0,
  }))
}

export async function crearLote(companyId: string, clienteId: string, ordenes: string[]): Promise<{ id: string; numero: string }> {
  const { data, error } = await supabase.rpc('mant_lote_crear', { p_company: companyId, p_customer: clienteId, p_orders: ordenes })
  if (error) throw new Error(traducir(error.message, error.code))
  const r = data as unknown as { id: string; number: string }
  return { id: r.id, numero: r.number }
}

export async function agregarAlLote(loteId: string, ordenes: string[]): Promise<void> {
  const { error } = await supabase.rpc('mant_lote_agregar', { p_batch: loteId, p_orders: ordenes })
  if (error) throw new Error(traducir(error.message, error.code))
}

export async function quitarDelLote(loteId: string, ordenId: string): Promise<void> {
  const { error } = await supabase.rpc('mant_lote_quitar', { p_batch: loteId, p_order: ordenId })
  if (error) throw new Error(traducir(error.message, error.code))
}

export async function aprobarLote(loteId: string, por: string): Promise<void> {
  const { error } = await supabase.rpc('mant_lote_aprobar', { p_batch: loteId, p_por: por.trim() === '' ? null : por.trim() })
  if (error) throw new Error(traducir(error.message, error.code))
}

export async function rechazarLote(loteId: string, motivo: string): Promise<void> {
  const { error } = await supabase.rpc('mant_lote_rechazar', { p_batch: loteId, p_motivo: motivo.trim() === '' ? null : motivo.trim() })
  if (error) throw new Error(traducir(error.message, error.code))
}

export async function pedidoDelLote(loteId: string): Promise<{ id: string; numero: string }> {
  const { data, error } = await supabase.rpc('mant_lote_crear_pedido', { p_batch: loteId })
  if (error) throw new Error(traducir(error.message, error.code))
  const r = data as unknown as { id: string; number: string }
  return { id: r.id, numero: r.number }
}

/** El lote de una orden, para mostrarlo en la orden. */
export async function loteDeOrden(companyId: string, loteId: string): Promise<{ id: string; numero: string; estado: EstadoLote } | null> {
  const { data, error } = await supabase
    .from('maintenance_quote_batches')
    .select('id, number, status')
    .eq('company_id', companyId)
    .eq('id', loteId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? { id: data.id, numero: data.number, estado: data.status as EstadoLote } : null
}
