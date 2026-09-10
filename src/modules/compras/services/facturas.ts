import { supabase } from '@/services/supabase/client'
import { tasaDe } from '../lib/tratamientos'
import type {
  EstadoFactura,
  FacturaDetalle,
  FacturaListado,
  FiltrosFacturas,
  LineaFactura,
  PaginaDeFacturas,
  PendienteDeFacturar,
  RelacionadosFactura,
} from '../types'

/**
 * Facturas de proveedor.
 *
 * Cinco reglas que vienen del servidor, no de esta pantalla:
 *
 *   1. **No mueven stock.** El stock entró con la recepción. Acá no hay ni un
 *      `stock_movements` ni un `stock_balances` a la vista.
 *   2. **Los totales los calcula el servidor**, desde las líneas.
 *   3. **La sobre-facturación se rechaza**: lo comprueba
 *      `registrar_factura_proveedor()` con las líneas de recepción bloqueadas.
 *   4. **Una factura registrada está congelada**; sólo puede anularse.
 *   5. El número REAL del proveedor no se repite: lo garantiza
 *      `uq_si_supplier_number`, un único parcial por proveedor.
 */

const vacioANulo = (s: string): string | null => {
  const t = s.trim()
  return t === '' ? null : t
}

const aNumero = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

const aNumeroONulo = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

// ── Qué falta facturar ─────────────────────────────────────────────────────

/**
 * Lo que quedó por facturar, línea de recepción por línea de recepción.
 *
 * Sólo mira recepciones **confirmadas**: facturar algo que todavía no llegó no
 * es facturar, es adelantar. Lo facturado cuenta sólo las facturas
 * `registered`, así que los borradores no reservan y una factura anulada
 * libera lo suyo.
 */
export async function pendienteDeFacturar(
  companyId: string,
  proveedorId: string | null,
  recepciones: readonly string[] | null = null,
  excluirFacturaId: string | null = null,
): Promise<PendienteDeFacturar[]> {
  const { data, error } = await supabase.rpc('pendiente_de_facturar', {
    p_company: companyId,
    p_receipts: recepciones ? [...recepciones] : null,
    p_supplier: proveedorId,
    p_excluir_factura: excluirFacturaId,
  })
  if (error) throw new Error(`No se pudo leer lo pendiente de facturar: ${error.message}`)

  return ((data ?? []) as unknown as {
    goods_receipt_line_id: string
    goods_receipt_id: string
    receipt_number: string
    receipt_date: string
    purchase_order_line_id: string | null
    purchase_order_id: string | null
    order_number: string | null
    currency_code: string | null
    product_id: string | null
    sku: string | null
    descripcion: string | null
    recibido: number | string
    facturado: number | string
    en_borrador: number | string
    pendiente: number | string
    precio_pedido: number | string | null
    tratamiento_pedido: string | null
    cantidad_pedida: number | string | null
  }[]).map((f) => ({
    goodsReceiptLineId: f.goods_receipt_line_id,
    recepcionId: f.goods_receipt_id,
    recepcionNumero: f.receipt_number,
    recepcionFecha: f.receipt_date,
    purchaseOrderLineId: f.purchase_order_line_id,
    pedidoId: f.purchase_order_id,
    pedidoNumero: f.order_number,
    moneda: f.currency_code,
    productId: f.product_id,
    sku: f.sku,
    descripcion: f.descripcion,
    recibido: aNumero(f.recibido),
    facturado: aNumero(f.facturado),
    enBorrador: aNumero(f.en_borrador),
    pendiente: aNumero(f.pendiente),
    precioPedido: aNumeroONulo(f.precio_pedido),
    tratamientoPedido: f.tratamiento_pedido,
    cantidadPedida: aNumeroONulo(f.cantidad_pedida),
  }))
}

// ── Listado ────────────────────────────────────────────────────────────────

const COLUMNAS_LISTADO = `
  id, number, supplier_number, invoice_date, due_date, currency_code, total,
  status, supplier_id,
  proveedor:suppliers!supplier_id ( legal_name ),
  autor:profiles!created_by ( full_name ),
  supplier_invoice_lines ( id, goods_receipt_line_id )
`

interface FilaListado {
  id: string
  number: string
  supplier_number: string | null
  invoice_date: string
  due_date: string | null
  currency_code: string
  total: number | string
  status: EstadoFactura
  supplier_id: string
  proveedor: { legal_name: string } | null
  autor: { full_name: string | null } | null
  supplier_invoice_lines: { id: string; goods_receipt_line_id: string | null }[] | null
}

export async function listarFacturas(
  companyId: string,
  filtros: FiltrosFacturas,
): Promise<PaginaDeFacturas> {
  let q = supabase
    .from('supplier_invoices')
    .select(COLUMNAS_LISTADO, { count: 'exact' })
    .eq('company_id', companyId)

  // La coma y los paréntesis rompen la sintaxis de PostgREST.
  const texto = filtros.q.trim().replace(/[,()*]/g, '')
  if (texto !== '') {
    // Se busca por las dos cosas: la referencia interna y el número real del
    // proveedor, que es el que la gente tiene en el papel.
    q = q.or(`number.ilike.%${texto}%,supplier_number.ilike.%${texto}%`)
  }
  if (filtros.proveedorId) q = q.eq('supplier_id', filtros.proveedorId)
  if (filtros.estado) q = q.eq('status', filtros.estado)
  if (filtros.moneda) q = q.eq('currency_code', filtros.moneda)
  if (filtros.desde) q = q.gte('invoice_date', filtros.desde)
  if (filtros.hasta) q = q.lte('invoice_date', filtros.hasta)

  const columna = {
    fecha: 'invoice_date',
    numero: 'number',
    numeroProveedor: 'supplier_number',
    proveedor: 'supplier_id',
    total: 'total',
  }[filtros.orden]
  const asc = filtros.direccion === 'asc'
  q = q.order(columna, { ascending: asc, nullsFirst: false })
  // Desempate estable: sin esto una fila puede salir dos veces entre páginas.
  if (columna !== 'number') q = q.order('number', { ascending: asc })

  const desde = (filtros.pagina - 1) * filtros.porPagina
  q = q.range(desde, desde + filtros.porPagina - 1)

  const { data, error, count } = await q
  if (error) throw new Error(`No se pudo leer el listado de facturas: ${error.message}`)

  const filas = (data ?? []) as unknown as FilaListado[]

  // Cuántas recepciones distintas toca cada factura. Se resuelve con una
  // consulta más, no con una por fila.
  const idsLinea = filas.flatMap((f) =>
    (f.supplier_invoice_lines ?? []).map((l) => l.goods_receipt_line_id).filter((x): x is string => x !== null),
  )
  const recepcionPorLinea = new Map<string, string>()
  if (idsLinea.length > 0) {
    const { data: rl } = await supabase
      .from('goods_receipt_lines')
      .select('id, goods_receipt_id')
      .eq('company_id', companyId)
      .in('id', [...new Set(idsLinea)])
    for (const l of rl ?? []) recepcionPorLinea.set(l.id, l.goods_receipt_id)
  }

  return {
    filas: filas.map((f) => ({
      id: f.id,
      numero: f.number,
      numeroProveedor: f.supplier_number,
      fecha: f.invoice_date,
      vencimiento: f.due_date,
      proveedorId: f.supplier_id,
      proveedor: f.proveedor?.legal_name ?? '(proveedor no accesible)',
      moneda: f.currency_code,
      total: aNumero(f.total),
      estado: f.status,
      lineas: (f.supplier_invoice_lines ?? []).length,
      recepciones: new Set(
        (f.supplier_invoice_lines ?? [])
          .map((l) => (l.goods_receipt_line_id ? recepcionPorLinea.get(l.goods_receipt_line_id) : null))
          .filter((x): x is string => !!x),
      ).size,
      autor: f.autor?.full_name ?? null,
    })),
    total: count ?? 0,
  }
}

/** Las monedas que realmente se usaron en facturas. Sin inventar. */
export async function monedasDeFacturas(companyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('supplier_invoices')
    .select('currency_code')
    .eq('company_id', companyId)
    .limit(2000)
  if (error) throw new Error(`No se pudieron leer las monedas: ${error.message}`)
  const vistas = new Set<string>()
  for (const f of (data ?? []) as unknown as { currency_code: string }[]) vistas.add(f.currency_code)
  return [...vistas].sort()
}

// ── Ficha ──────────────────────────────────────────────────────────────────

const COLUMNAS_DETALLE = `
  id, number, series_code, supplier_number, status, supplier_id, currency_code,
  exchange_rate, invoice_date, due_date, payment_terms, notes, subtotal,
  tax_amount, total, created_at, updated_at,
  proveedor:suppliers!supplier_id ( legal_name ),
  autor:profiles!created_by ( full_name )
`

export async function obtenerFactura(
  companyId: string,
  id: string,
): Promise<FacturaDetalle | null> {
  const { data, error } = await supabase
    .from('supplier_invoices')
    .select(COLUMNAS_DETALLE)
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer la factura: ${error.message}`)
  if (!data) return null

  const f = data as unknown as {
    id: string
    number: string
    series_code: string
    supplier_number: string | null
    status: EstadoFactura
    supplier_id: string
    currency_code: string
    exchange_rate: number | string | null
    invoice_date: string
    due_date: string | null
    payment_terms: string | null
    notes: string | null
    subtotal: number | string
    tax_amount: number | string
    total: number | string
    created_at: string
    updated_at: string
    proveedor: { legal_name: string } | null
    autor: { full_name: string | null } | null
  }

  return {
    id: f.id,
    numero: f.number,
    serie: f.series_code,
    numeroProveedor: f.supplier_number,
    estado: f.status,
    proveedorId: f.supplier_id,
    proveedor: f.proveedor?.legal_name ?? '(proveedor no accesible)',
    moneda: f.currency_code,
    tipoCambio: aNumeroONulo(f.exchange_rate),
    fecha: f.invoice_date,
    vencimiento: f.due_date,
    formaPago: f.payment_terms,
    notas: f.notes,
    subtotal: aNumero(f.subtotal),
    impuesto: aNumero(f.tax_amount),
    total: aNumero(f.total),
    autor: f.autor?.full_name ?? null,
    creadoEn: f.created_at,
    actualizadoEn: f.updated_at,
  }
}

/**
 * Las líneas, con lo que decía el pedido al lado.
 *
 * El snapshot de la orden se trae por `purchase_order_line_id` para poder
 * mostrar las diferencias de precio y de impuesto sin ninguna tabla de
 * discrepancias.
 */
export async function lineasDeFactura(
  companyId: string,
  facturaId: string,
): Promise<LineaFactura[]> {
  const { data, error } = await supabase
    .from('supplier_invoice_lines')
    .select(
      `id, line_no, goods_receipt_line_id, purchase_order_line_id, product_id,
       sku_snapshot, description_snapshot, quantity, unit_price, discount_pct,
       tax_treatment, tax_rate_snapshot, line_total,
       recepcion:goods_receipt_lines!goods_receipt_line_id (
         goods_receipt:goods_receipts!goods_receipt_id ( number )
       ),
       pedido:purchase_order_lines!purchase_order_line_id (
         unit_price, tax_treatment,
         purchase_order:purchase_orders!purchase_order_id ( number )
       )`,
    )
    .eq('company_id', companyId)
    .eq('supplier_invoice_id', facturaId)
    .order('line_no', { ascending: true })
  if (error) throw new Error(`No se pudieron leer las líneas: ${error.message}`)

  return ((data ?? []) as unknown as {
    id: string
    line_no: number
    goods_receipt_line_id: string | null
    purchase_order_line_id: string | null
    product_id: string | null
    sku_snapshot: string | null
    description_snapshot: string | null
    quantity: number | string
    unit_price: number | string
    discount_pct: number | string
    tax_treatment: string
    tax_rate_snapshot: number | string | null
    line_total: number | string
    recepcion: { goods_receipt: { number: string } | null } | null
    pedido: {
      unit_price: number | string | null
      tax_treatment: string
      purchase_order: { number: string } | null
    } | null
  }[]).map((l) => ({
    id: l.id,
    numeroLinea: l.line_no,
    goodsReceiptLineId: l.goods_receipt_line_id,
    purchaseOrderLineId: l.purchase_order_line_id,
    productId: l.product_id,
    sku: l.sku_snapshot,
    descripcion: l.description_snapshot,
    cantidad: aNumero(l.quantity),
    precioUnitario: aNumero(l.unit_price),
    descuentoPct: aNumero(l.discount_pct),
    tratamientoImpuesto: l.tax_treatment,
    tasaImpuesto: aNumeroONulo(l.tax_rate_snapshot),
    netoServidor: aNumero(l.line_total),
    recepcionNumero: l.recepcion?.goods_receipt?.number ?? null,
    pedidoNumero: l.pedido?.purchase_order?.number ?? null,
    precioPedido: aNumeroONulo(l.pedido?.unit_price),
    tratamientoPedido: l.pedido?.tax_treatment ?? null,
  }))
}


/**
 * Los documentos que quedan del otro lado.
 *
 * **No hay FK de cabecera a `purchase_orders`**, a propósito: una factura
 * puede tocar varias órdenes. La trazabilidad se deriva por las líneas —
 * `invoice_line → receipt_line → purchase_order_line → purchase_order`— que es
 * exactamente como está modelado.
 */
export async function relacionadosDeFactura(
  companyId: string,
  facturaId: string,
): Promise<RelacionadosFactura> {
  const { data, error } = await supabase
    .from('supplier_invoice_lines')
    .select(
      `goods_receipt_line_id, purchase_order_line_id,
       recepcion:goods_receipt_lines!goods_receipt_line_id (
         goods_receipt:goods_receipts!goods_receipt_id ( id, number, receipt_date )
       ),
       pedido:purchase_order_lines!purchase_order_line_id (
         purchase_order:purchase_orders!purchase_order_id ( id, number )
       )`,
    )
    .eq('company_id', companyId)
    .eq('supplier_invoice_id', facturaId)
  if (error) throw new Error(`No se pudieron leer los relacionados: ${error.message}`)

  const recepciones = new Map<string, { id: string; numero: string; fecha: string }>()
  const pedidos = new Map<string, { id: string; numero: string }>()

  for (const l of (data ?? []) as unknown as {
    recepcion: { goods_receipt: { id: string; number: string; receipt_date: string } | null } | null
    pedido: { purchase_order: { id: string; number: string } | null } | null
  }[]) {
    const r = l.recepcion?.goods_receipt
    if (r) recepciones.set(r.id, { id: r.id, numero: r.number, fecha: r.receipt_date })
    const p = l.pedido?.purchase_order
    if (p) pedidos.set(p.id, { id: p.id, numero: p.number })
  }

  return {
    recepciones: [...recepciones.values()].sort((a, b) => a.numero.localeCompare(b.numero)),
    pedidos: [...pedidos.values()].sort((a, b) => a.numero.localeCompare(b.numero)),
  }
}

// ── Escritura ──────────────────────────────────────────────────────────────

export interface DatosFactura {
  proveedorId: string
  numeroProveedor: string
  moneda: string
  tipoCambio: string
  fecha: string
  vencimiento: string
  formaPago: string
  notas: string
}

/** Una línea que se va a facturar. */
export interface LineaAFacturar {
  goodsReceiptLineId: string | null
  purchaseOrderLineId: string | null
  productId: string | null
  sku: string | null
  descripcion: string | null
  cantidad: number
  precioUnitario: number
  descuentoPct: number
  tratamientoImpuesto: string
  tasaImpuesto: number | null
}

function filaLinea(companyId: string, facturaId: string, l: LineaAFacturar, lineNo: number) {
  return {
    company_id: companyId,
    supplier_invoice_id: facturaId,
    line_no: lineNo,
    line_type: 'product',
    // El producto y la línea del pedido los deriva el trigger desde la línea
    // de recepción; se mandan igual por si la línea es libre.
    goods_receipt_line_id: l.goodsReceiptLineId,
    purchase_order_line_id: l.purchaseOrderLineId,
    product_id: l.productId,
    sku_snapshot: l.sku?.trim() || null,
    description_snapshot: l.descripcion?.trim() || null,
    quantity: l.cantidad,
    unit_price: l.precioUnitario,
    discount_pct: l.descuentoPct,
    tax_treatment: l.tratamientoImpuesto,
    // Sólo se manda en `other`: en el resto la pone el servidor desde el
    // tratamiento, y por eso el bug del 1 % no se puede reproducir.
    tax_rate_snapshot: l.tratamientoImpuesto === 'other' ? l.tasaImpuesto : null,
  }
}

function cabecera(d: DatosFactura) {
  return {
    supplier_id: d.proveedorId,
    supplier_number: vacioANulo(d.numeroProveedor),
    currency_code: d.moneda,
    exchange_rate: d.tipoCambio.trim() === '' ? null : Number(d.tipoCambio.replace(',', '.')),
    invoice_date: d.fecha,
    due_date: vacioANulo(d.vencimiento),
    payment_terms: vacioANulo(d.formaPago),
    notes: vacioANulo(d.notas),
  }
}

async function proximoNumero(companyId: string): Promise<string> {
  const { data, error } = await supabase.rpc('next_document_number', {
    p_company: companyId,
    p_doc_type: 'supplier_invoice',
  })
  if (error) throw new Error(`No se pudo obtener la referencia: ${traducir(error.message, error.code)}`)
  if (!data) throw new Error('La numeración no devolvió ninguna referencia')
  return data
}

/**
 * Alta.
 *
 * La factura nace en **borrador** y no mueve nada. La referencia interna `FP`
 * la da `next_document_number`; el número real del proveedor lo escribe la
 * persona y es el que no se puede repetir.
 */
export async function crearFactura(
  companyId: string,
  d: DatosFactura,
  lineas: readonly LineaAFacturar[],
): Promise<{ id: string; numero: string }> {
  const conCantidad = lineas.filter((l) => l.cantidad > 0)
  if (conCantidad.length === 0) {
    throw new Error('No hay ninguna línea cargada: una factura vacía no es una factura.')
  }

  const numero = await proximoNumero(companyId)

  const { data, error } = await supabase
    .from('supplier_invoices')
    .insert({ company_id: companyId, number: numero, series_code: 'FP', status: 'draft', ...cabecera(d) })
    .select('id, number')
    .single()
  if (error) throw new Error(traducir(error.message, error.code))

  const { error: eL } = await supabase
    .from('supplier_invoice_lines')
    .insert(conCantidad.map((l, i) => filaLinea(companyId, data.id, l, i + 1)))
  if (eL) {
    // La cabecera quedó sin líneas: se borra para no dejar un documento vacío
    // con una referencia gastada. Es un borrador, así que se puede.
    await supabase.from('supplier_invoices').delete().eq('id', data.id)
    throw new Error(traducir(eL.message, eL.code))
  }

  return { id: data.id, numero: data.number }
}

export async function actualizarFactura(
  companyId: string,
  id: string,
  d: DatosFactura,
): Promise<void> {
  const { error } = await supabase
    .from('supplier_invoices')
    .update(cabecera(d))
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

/** Reemplaza las líneas de un borrador. Una registrada no llega acá. */
export async function guardarLineasFactura(
  companyId: string,
  facturaId: string,
  lineas: readonly LineaAFacturar[],
): Promise<void> {
  const conCantidad = lineas.filter((l) => l.cantidad > 0)
  if (conCantidad.length === 0) {
    throw new Error('No hay ninguna línea cargada: una factura vacía no es una factura.')
  }

  const { error: eDel } = await supabase
    .from('supplier_invoice_lines')
    .delete()
    .eq('company_id', companyId)
    .eq('supplier_invoice_id', facturaId)
  if (eDel) throw new Error(traducir(eDel.message, eDel.code))

  const { error } = await supabase
    .from('supplier_invoice_lines')
    .insert(conCantidad.map((l, i) => filaLinea(companyId, facturaId, l, i + 1)))
  if (error) throw new Error(traducir(error.message, error.code))
}

export async function borrarFactura(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('supplier_invoices')
    .delete()
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

/**
 * Registrar.
 *
 * Del lado del servidor y en una sola transacción: bloquea las líneas de
 * recepción, valida que no se facture más de lo recibido y cambia el estado.
 * **No mueve stock.** Es idempotente.
 */
export async function registrarFactura(id: string): Promise<{ yaEstaba: boolean; lineas: number }> {
  const { data, error } = await supabase.rpc('registrar_factura_proveedor', { p_invoice: id })
  if (error) throw new Error(traducir(error.message, error.code))
  const r = data as unknown as { ya_estaba: boolean; lineas: number }
  return { yaEstaba: r.ya_estaba, lineas: r.lineas }
}

/**
 * Anular.
 *
 * Una factura no mueve stock, así que anularla no deshace nada físico: lo que
 * hace es **liberar lo facturado**, porque lo pendiente cuenta sólo las
 * registradas. Queda congelada.
 */
export async function anularFactura(companyId: string, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('supplier_invoices')
    .update({ status: 'cancelled' })
    .eq('company_id', companyId)
    .eq('id', id)
    .in('status', ['draft', 'registered'])
    .select('id')
  if (error) throw new Error(traducir(error.message, error.code))
  return (data ?? []).length > 0
}

/** La alícuota que corresponde a un tratamiento. Se reexporta por comodidad. */
export { tasaDe }

/** El error de Postgres, en castellano. */
function traducir(mensaje: string, codigo?: string): string {
  if (codigo === '23001' || codigo === '23514') return mensaje
  if (codigo === '23505' && mensaje.includes('uq_si_supplier_number')) {
    return 'Ese número de factura ya está cargado para este proveedor.'
  }
  if (codigo === '23505' && mensaje.includes('number')) {
    return 'Esa referencia interna ya existe.'
  }
  if (codigo === '23503' && mensaje.includes('currency')) {
    return 'Esa moneda no existe en el sistema.'
  }
  if (codigo === '23502' && mensaje.includes('currency_code')) {
    return 'La moneda es obligatoria.'
  }
  if (codigo === '42501') {
    return 'No tenés permiso para hacer este cambio. Compras es de administradores y empleados.'
  }
  return mensaje
}

/**
 * Exporta **lo que muestran los filtros**, no la tabla entera.
 *
 * Pide páginas al servidor de a 1000 en vez de traerse todo al navegador, y
 * corta en 5000: una exportación más grande que eso es un pedido de informe, no de pantalla.
 */
export async function exportarFacturas(
  companyId: string,
  filtros: FiltrosFacturas,
): Promise<{ filas: FacturaListado[]; total: number }> {
  const TAMANO = 1000
  const TOPE = 5000
  const primera = await listarFacturas(companyId, { ...filtros, pagina: 1, porPagina: TAMANO })
  const filas = [...primera.filas]
  const total = primera.total
  for (let pagina = 2; filas.length < total && filas.length < TOPE; pagina += 1) {
    const p = await listarFacturas(companyId, { ...filtros, pagina, porPagina: TAMANO })
    // Una página vacía corta el bucle: sin esto, un `total` que no coincida
    // con lo que devuelve el servidor lo dejaría girando para siempre.
    if (p.filas.length === 0) break
    filas.push(...p.filas)
  }
  return { filas, total }
}
