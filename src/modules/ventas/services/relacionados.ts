import { supabase } from '@/services/supabase/client'
import type { DocumentoRelacionado, Relacionados, TipoDocumento } from '../types'

/**
 * Los documentos vinculados a uno dado.
 *
 * El legacy los buscaba comparando textos (`fromCotizacion`, `fromPedido`
 * guardaban la referencia como string). Acá son claves foráneas reales, así
 * que la cadena se recorre sin ambigüedad en las dos direcciones.
 *
 * Las facturas y los pagos se consultan igual aunque hoy sus tablas estén
 * vacías: cuando aparezcan, el panel se llena solo. Mostrar la sección vacía
 * es más honesto que ocultarla —dice "no hay", no "no existe el concepto".
 */

const VACIO: Relacionados = {
  cotizaciones: [],
  pedidos: [],
  entregas: [],
  facturas: [],
  pagos: [],
}

function fila(
  tipo: TipoDocumento,
  f: {
    id: string
    number: string
    original_number?: string | null
    currency_code: string | null
    total: number | string | null
  },
  fecha: string,
  estado: string,
): DocumentoRelacionado {
  const total = f.total === null || f.total === undefined ? null : Number(f.total)
  return {
    tipo,
    id: f.id,
    numero: f.original_number ?? f.number,
    fecha,
    estado,
    moneda: f.currency_code,
    total: total !== null && Number.isFinite(total) ? total : null,
  }
}

type FilaCot = {
  id: string
  number: string
  original_number: string | null
  quote_date: string
  status: string
  currency_code: string | null
  total: number | string | null
}
type FilaPed = {
  id: string
  number: string
  original_number: string | null
  order_date: string
  commercial_status: string
  currency_code: string | null
  total: number | string | null
  quote_id: string | null
}
type FilaEnt = {
  id: string
  number: string
  original_number: string | null
  delivery_date: string
  status: string
  currency_code: string | null
  total: number | string | null
  order_id: string | null
}

const COLS_COT = 'id, number, original_number, quote_date, status, currency_code, total'
const COLS_PED =
  'id, number, original_number, order_date, commercial_status, currency_code, total, quote_id'
const COLS_ENT =
  'id, number, original_number, delivery_date, status, currency_code, total, order_id'

export async function documentosRelacionados(
  tipo: TipoDocumento,
  companyId: string,
  id: string,
): Promise<Relacionados> {
  const base = () => ({ ...VACIO })
  const r = base()

  // ── Se resuelve la cadena completa: cotización ─ pedidos ─ entregas ──────
  let cotizacionIds: string[] = []
  let pedidoIds: string[] = []

  if (tipo === 'cotizacion') {
    cotizacionIds = [id]
  } else if (tipo === 'pedido') {
    pedidoIds = [id]
  } else {
    const { data } = await supabase
      .from('deliveries')
      .select('order_id')
      .eq('company_id', companyId)
      .eq('id', id)
      .maybeSingle()
    const orderId = data?.order_id ?? null
    if (orderId) pedidoIds = [orderId]
  }

  // Pedidos de la cotización
  if (cotizacionIds.length > 0) {
    const { data, error } = await supabase
      .from('sales_orders')
      .select(COLS_PED)
      .eq('company_id', companyId)
      .in('quote_id', cotizacionIds)
      .order('order_date', { ascending: true })
    if (error) throw new Error(`Relacionados (pedidos): ${error.message}`)
    const filas = (data ?? []) as unknown as FilaPed[]
    r.pedidos = filas.map((f) => fila('pedido', f, f.order_date, f.commercial_status))
    pedidoIds = filas.map((f) => f.id)
  }

  // Cotización del pedido
  if (tipo !== 'cotizacion' && pedidoIds.length > 0) {
    const { data, error } = await supabase
      .from('sales_orders')
      .select(COLS_PED)
      .eq('company_id', companyId)
      .in('id', pedidoIds)
    if (error) throw new Error(`Relacionados (pedido): ${error.message}`)
    const filas = (data ?? []) as unknown as FilaPed[]
    if (tipo === 'entrega') {
      r.pedidos = filas.map((f) => fila('pedido', f, f.order_date, f.commercial_status))
    }
    cotizacionIds = filas.map((f) => f.quote_id).filter((x): x is string => x !== null)

    if (cotizacionIds.length > 0) {
      const { data: cots, error: e2 } = await supabase
        .from('sales_quotes')
        .select(COLS_COT)
        .eq('company_id', companyId)
        .in('id', cotizacionIds)
      if (e2) throw new Error(`Relacionados (cotización): ${e2.message}`)
      r.cotizaciones = ((cots ?? []) as unknown as FilaCot[]).map((f) =>
        fila('cotizacion', f, f.quote_date, f.status),
      )
    }
  }

  // Entregas de esos pedidos
  if (pedidoIds.length > 0) {
    const { data, error } = await supabase
      .from('deliveries')
      .select(COLS_ENT)
      .eq('company_id', companyId)
      .in('order_id', pedidoIds)
      .order('delivery_date', { ascending: true })
    if (error) throw new Error(`Relacionados (entregas): ${error.message}`)
    r.entregas = ((data ?? []) as unknown as FilaEnt[]).map((f) =>
      fila('entrega', f, f.delivery_date, f.status),
    )
  }

  // El propio documento no se lista como relacionado de sí mismo.
  if (tipo === 'entrega') r.entregas = r.entregas.filter((e) => e.id !== id)

  // ── Facturas y pagos: hoy 0 filas, la consulta ya queda hecha ────────────
  if (pedidoIds.length > 0) {
    const { data } = await supabase
      .from('sales_invoices')
      .select('id, number, original_number, invoice_date, status, currency_code, total')
      .eq('company_id', companyId)
      .in('order_id', pedidoIds)
    const filas = (data ?? []) as unknown as {
      id: string
      number: string
      original_number: string | null
      invoice_date: string
      status: string
      currency_code: string | null
      total: number | string | null
    }[]
    r.facturas = filas.map((f) => ({
      tipo: 'factura' as const,
      id: f.id,
      numero: f.original_number ?? f.number,
      fecha: f.invoice_date,
      estado: f.status,
      moneda: f.currency_code,
      total: f.total === null ? null : Number(f.total),
    }))
  }

  return r
}

/**
 * Lo que hace falta para calcular el pendiente de un pedido.
 *
 * Devuelve las líneas de entrega de TODAS sus entregas y —esto es lo que
 * separa los 5 pedidos limpios de los 21 dudosos— si el cliente tiene algún
 * remito que el legacy nunca enlazó a un pedido.
 */
export async function evidenciaDeEntrega(
  companyId: string,
  pedidoId: string,
  customerId: string | null,
): Promise<{
  lineasEntrega: { ordenLineaId: string | null; cantidad: number }[]
  hayEntregasEnlazadas: boolean
  hayRemitosHuerfanosDelCliente: boolean
}> {
  const { data: entregas, error } = await supabase
    .from('deliveries')
    .select('id')
    .eq('company_id', companyId)
    .eq('order_id', pedidoId)
  if (error) throw new Error(`Entregas del pedido: ${error.message}`)

  const ids = ((entregas ?? []) as { id: string }[]).map((e) => e.id)

  let lineasEntrega: { ordenLineaId: string | null; cantidad: number }[] = []
  if (ids.length > 0) {
    const { data, error: e2 } = await supabase
      .from('delivery_lines')
      .select('order_line_id, quantity')
      .eq('company_id', companyId)
      .in('delivery_id', ids)
    if (e2) throw new Error(`Líneas de entrega: ${e2.message}`)
    lineasEntrega = ((data ?? []) as { order_line_id: string | null; quantity: number | string }[])
      .map((l) => ({ ordenLineaId: l.order_line_id, cantidad: Number(l.quantity) }))
  }

  let hayHuerfanos = false
  // Sólo hace falta preguntarlo cuando NO hay entregas: es el único caso en
  // que la respuesta cambia lo que se muestra.
  if (ids.length === 0 && customerId) {
    const { count } = await supabase
      .from('deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .is('order_id', null)
    hayHuerfanos = (count ?? 0) > 0
  }

  return {
    lineasEntrega,
    hayEntregasEnlazadas: ids.length > 0,
    hayRemitosHuerfanosDelCliente: hayHuerfanos,
  }
}
