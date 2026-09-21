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
      .select('order_id, source_quote_id')
      .eq('company_id', companyId)
      .eq('id', id)
      .maybeSingle()
    const orderId = data?.order_id ?? null
    if (orderId) pedidoIds = [orderId]
    // Fase 15 · E6: hay 11 remitos que no salen de un pedido pero sí apuntan a
    // una cotización (`source_quote_id`; el CHECK impide que tengan los dos).
    // Antes ese remito se mostraba sin ningún origen, como si no tuviera.
    else if (data?.source_quote_id) cotizacionIds = [data.source_quote_id]
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

  // La cotización de un remito que no pasó por un pedido. Se pide sólo si no
  // la trajo el camino del pedido: dos consultas para lo mismo no.
  if (tipo === 'entrega' && r.cotizaciones.length === 0 && cotizacionIds.length > 0) {
    const { data, error } = await supabase
      .from('sales_quotes')
      .select(COLS_COT)
      .eq('company_id', companyId)
      .in('id', cotizacionIds)
    if (error) throw new Error(`Relacionados (cotización): ${error.message}`)
    r.cotizaciones = ((data ?? []) as unknown as FilaCot[]).map((f) =>
      fila('cotizacion', f, f.quote_date, f.status),
    )
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

  // Cobranzas: se llega por las imputaciones de las facturas. La consulta sólo
  // se hace si hay facturas —hoy no hay ninguna—: preguntar por las cobranzas
  // de una lista vacía es un viaje al servidor para que conteste «nada».
  if (r.facturas.length > 0) {
    const { data } = await supabase
      .from('payment_allocations')
      .select('amount, pago:payments!payment_id ( id, payment_date, amount, currency_code, method )')
      .eq('company_id', companyId)
      .in('invoice_id', r.facturas.map((f) => f.id))
    const filas = (data ?? []) as unknown as {
      pago: { id: string; payment_date: string; amount: number | string | null; currency_code: string | null; method: string | null } | null
    }[]
    const vistos = new Set<string>()
    r.pagos = filas.flatMap((x) => {
      if (!x.pago || vistos.has(x.pago.id)) return []
      vistos.add(x.pago.id)
      return [{
        tipo: 'pago' as const,
        id: x.pago.id,
        numero: x.pago.method ?? 'Cobranza',
        fecha: x.pago.payment_date,
        estado: 'registrado',
        moneda: x.pago.currency_code,
        total: x.pago.amount === null ? null : Number(x.pago.amount),
      }]
    })
  }

  return r
}

/** Los estados en los que la mercadería YA salió del depósito. */
const DESPACHADOS = new Set(['shipped', 'delivered'])

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
  lineasEntrega: { ordenLineaId: string | null; cantidad: number; despachada: boolean }[]
  hayEntregasEnlazadas: boolean
  hayRemitosHuerfanosDelCliente: boolean
}> {
  // El estado viene con cada remito: un borrador no entregó nada, y hay que
  // poder contarlo aparte (Fase 19 · E5). Los cancelados no cuentan para nada:
  // es la misma regla que usa el servidor para el pendiente.
  const { data: entregas, error } = await supabase
    .from('deliveries')
    .select('id, status')
    .eq('company_id', companyId)
    .eq('order_id', pedidoId)
    .neq('status', 'cancelled')
  if (error) throw new Error(`Entregas del pedido: ${error.message}`)

  const estados = new Map<string, string>(
    ((entregas ?? []) as { id: string; status: string }[]).map((e) => [e.id, e.status]),
  )
  const ids = [...estados.keys()]

  let lineasEntrega: { ordenLineaId: string | null; cantidad: number; despachada: boolean }[] = []
  if (ids.length > 0) {
    const { data, error: e2 } = await supabase
      .from('delivery_lines')
      .select('order_line_id, quantity, delivery_id')
      .eq('company_id', companyId)
      .in('delivery_id', ids)
    if (e2) throw new Error(`Líneas de entrega: ${e2.message}`)
    lineasEntrega = (
      (data ?? []) as { order_line_id: string | null; quantity: number | string; delivery_id: string }[]
    ).map((l) => ({
      ordenLineaId: l.order_line_id,
      cantidad: Number(l.quantity),
      despachada: DESPACHADOS.has(estados.get(l.delivery_id) ?? ''),
    }))
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

/** Una línea del pedido, vista desde un remito concreto (Fase 19 · E5). */
export interface AvanceDeLinea {
  lineaPedidoId: string
  sku: string | null
  nombre: string | null
  pedido: number
  /** Lo que salió en OTROS remitos ya despachados. */
  yaEntregado: number
  /** Lo que lleva ESTE remito. */
  estaEntrega: number
  /** Lo que quedaría pendiente si este remito se despacha. */
  pendienteDespues: number
}

export interface AvanceDelRemito {
  lineas: AvanceDeLinea[]
  /** Líneas de ESTE remito que no están enlazadas a una línea del pedido. */
  sinEnlazar: number
  /** Otros remitos del pedido con alguna línea sin enlazar: el reparto no es confiable. */
  repartoDudoso: boolean
}

/**
 * Pedido / ya entregado / esta entrega / pendiente después.
 *
 * Los cuatro números que hacen falta para mirar un remito sin tener que abrir
 * el pedido. Se calculan sólo donde el vínculo por línea existe: si alguna
 * línea de entrega no está enlazada —147 de las 631 migradas—, el reparto por
 * línea deja de ser confiable y se dice, en vez de inventarlo.
 */
export async function avanceDelRemito(
  companyId: string,
  remitoId: string,
  pedidoId: string,
): Promise<AvanceDelRemito> {
  const { data: lineasPedido, error } = await supabase
    .from('sales_order_lines')
    .select('id, sku_snapshot, name_snapshot, quantity_ordered, line_type')
    .eq('company_id', companyId)
    .eq('order_id', pedidoId)
    .order('line_no')
  if (error) throw new Error(`Líneas del pedido: ${error.message}`)

  const { data: entregas, error: e2 } = await supabase
    .from('deliveries')
    .select('id, status')
    .eq('company_id', companyId)
    .eq('order_id', pedidoId)
    .neq('status', 'cancelled')
  if (e2) throw new Error(`Entregas del pedido: ${e2.message}`)

  const estados = new Map<string, string>(
    ((entregas ?? []) as { id: string; status: string }[]).map((e) => [e.id, e.status]),
  )

  const { data: lineasEntrega, error: e3 } = await supabase
    .from('delivery_lines')
    .select('order_line_id, quantity, delivery_id')
    .eq('company_id', companyId)
    .in('delivery_id', [...estados.keys()])
  if (e3) throw new Error(`Líneas de entrega: ${e3.message}`)

  const filas = (lineasEntrega ?? []) as {
    order_line_id: string | null
    quantity: number | string
    delivery_id: string
  }[]

  const ya = new Map<string, number>()
  const esta = new Map<string, number>()
  let sinEnlazar = 0
  let repartoDudoso = false
  for (const l of filas) {
    if (l.order_line_id === null) {
      if (l.delivery_id === remitoId) sinEnlazar += 1
      else repartoDudoso = true
      continue
    }
    const cantidad = Number(l.quantity)
    if (l.delivery_id === remitoId) {
      esta.set(l.order_line_id, (esta.get(l.order_line_id) ?? 0) + cantidad)
    } else if (DESPACHADOS.has(estados.get(l.delivery_id) ?? '')) {
      ya.set(l.order_line_id, (ya.get(l.order_line_id) ?? 0) + cantidad)
    }
  }

  const lineas = ((lineasPedido ?? []) as {
    id: string
    sku_snapshot: string | null
    name_snapshot: string | null
    quantity_ordered: number | string
    line_type: string | null
  }[])
    .filter((l) => l.line_type !== 'chapter')
    .map((l) => {
      const pedido = Number(l.quantity_ordered)
      const yaEntregado = ya.get(l.id) ?? 0
      const estaEntrega = esta.get(l.id) ?? 0
      return {
        lineaPedidoId: l.id,
        sku: l.sku_snapshot,
        nombre: l.name_snapshot,
        pedido,
        yaEntregado,
        estaEntrega,
        pendienteDespues: Math.max(pedido - yaEntregado - estaEntrega, 0),
      }
    })

  return { lineas, sinEnlazar, repartoDudoso }
}
