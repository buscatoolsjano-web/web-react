import { supabase } from '@/services/supabase/client'
import type { DatosPedidoCompra } from '../lib/validacion'
import type {
  EstadoPedido,
  EstadoRecepcion,
  FiltrosPedidos,
  LineaPedidoCompra,
  PaginaDePedidos,
  PedidoCompraDetalle,
  PedidoCompraListado,
  RelacionadosPedido,
} from '../types'

/**
 * Pedidos de compra.
 *
 * Tres reglas que no se negocian, iguales a las de Ventas:
 *
 *   1. **Los totales los calcula el servidor.** `subtotal`, `tax_amount` y
 *      `total` los escribe `app.recalcular_totales_pedido_compra()` desde las
 *      líneas. Este archivo nunca los manda; si los mandara, el trigger los
 *      pisaría igual.
 *   2. **El número sale de `next_document_number()`**, un UPDATE con bloqueo
 *      de fila. Jamás `MAX+1`.
 *   3. **Quién puede escribir lo decide RLS**: `purchase_orders` es admin y
 *      employee. Y qué se puede escribir en cada estado lo deciden los
 *      triggers, no los botones deshabilitados de la pantalla.
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

// ── Listado ────────────────────────────────────────────────────────────────

const COLUMNAS_LISTADO = `
  id, number, order_date, expected_date, currency_code, total, status,
  receipt_status, supplier_id,
  proveedor:suppliers!supplier_id ( legal_name ),
  autor:profiles!created_by ( full_name ),
  purchase_order_lines ( id )
`

interface FilaListado {
  id: string
  number: string
  order_date: string
  expected_date: string | null
  currency_code: string
  total: number | string
  status: EstadoPedido
  receipt_status: EstadoRecepcion
  supplier_id: string
  proveedor: { legal_name: string } | null
  autor: { full_name: string | null } | null
  purchase_order_lines: { id: string }[] | null
}

export async function listarPedidos(
  companyId: string,
  filtros: FiltrosPedidos,
): Promise<PaginaDePedidos> {
  let q = supabase
    .from('purchase_orders')
    .select(COLUMNAS_LISTADO, { count: 'exact' })
    .eq('company_id', companyId)

  // La coma y los paréntesis rompen la sintaxis de PostgREST: el texto entra
  // dentro de un `or`.
  const texto = filtros.q.trim().replace(/[,()*]/g, '')
  if (texto !== '') q = q.ilike('number', `%${texto}%`)
  if (filtros.proveedorId) q = q.eq('supplier_id', filtros.proveedorId)
  if (filtros.estado) q = q.eq('status', filtros.estado)
  if (filtros.estadoRecepcion) q = q.eq('receipt_status', filtros.estadoRecepcion)
  if (filtros.moneda) q = q.eq('currency_code', filtros.moneda)
  if (filtros.desde) q = q.gte('order_date', filtros.desde)
  if (filtros.hasta) q = q.lte('order_date', filtros.hasta)
  // «Sin ETA» y un rango de ETA son excluyentes: si se piden los dos, gana
  // el «sin ETA», que es el más específico.
  if (filtros.sinEta) q = q.is('expected_date', null)
  else {
    if (filtros.etaDesde) q = q.gte('expected_date', filtros.etaDesde)
    if (filtros.etaHasta) q = q.lte('expected_date', filtros.etaHasta)
  }

  const columna = {
    fecha: 'order_date',
    numero: 'number',
    proveedor: 'supplier_id',
    total: 'total',
    eta: 'expected_date',
  }[filtros.orden]
  const asc = filtros.direccion === 'asc'
  q = q.order(columna, { ascending: asc, nullsFirst: false })
  // Desempate estable: sin esto dos pedidos del mismo día pueden cambiar de
  // orden entre páginas y una fila sale dos veces o ninguna.
  if (columna !== 'number') q = q.order('number', { ascending: asc })

  const desde = (filtros.pagina - 1) * filtros.porPagina
  q = q.range(desde, desde + filtros.porPagina - 1)

  const { data, error, count } = await q
  if (error) throw new Error(`No se pudo leer el listado de pedidos: ${error.message}`)

  return {
    filas: ((data ?? []) as unknown as FilaListado[]).map((f) => ({
      id: f.id,
      numero: f.number,
      fecha: f.order_date,
      proveedorId: f.supplier_id,
      proveedor: f.proveedor?.legal_name ?? '(proveedor no accesible)',
      moneda: f.currency_code,
      total: aNumero(f.total),
      estado: f.status,
      estadoRecepcion: f.receipt_status,
      fechaEstimada: f.expected_date,
      autor: f.autor?.full_name ?? null,
      lineas: (f.purchase_order_lines ?? []).length,
    })),
    total: count ?? 0,
  }
}

/** Exporta lo que muestran los filtros, pidiendo páginas al servidor. */
export async function exportarPedidos(
  companyId: string,
  filtros: FiltrosPedidos,
): Promise<{ filas: PedidoCompraListado[]; total: number }> {
  const TAMANO = 500
  const TOPE = 5000
  const primera = await listarPedidos(companyId, { ...filtros, pagina: 1, porPagina: TAMANO })
  const filas = [...primera.filas]
  for (let pagina = 2; filas.length < primera.total && filas.length < TOPE; pagina += 1) {
    const p = await listarPedidos(companyId, { ...filtros, pagina, porPagina: TAMANO })
    if (p.filas.length === 0) break
    filas.push(...p.filas)
  }
  return { filas, total: primera.total }
}

/** Las monedas que realmente se usaron, para el filtro. Sin inventar. */
export async function monedasUsadas(companyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('purchase_orders')
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
  id, number, series_code, status, receipt_status, supplier_id, currency_code,
  exchange_rate, order_date, expected_date, payment_terms, notes, subtotal,
  tax_amount, total, created_at, updated_at,
  proveedor:suppliers!supplier_id ( legal_name, legacy_ref ),
  autor:profiles!created_by ( full_name )
`

interface FilaDetalle {
  id: string
  number: string
  series_code: string
  status: EstadoPedido
  receipt_status: EstadoRecepcion
  supplier_id: string
  currency_code: string
  exchange_rate: number | string | null
  order_date: string
  expected_date: string | null
  payment_terms: string | null
  notes: string | null
  subtotal: number | string
  tax_amount: number | string
  total: number | string
  created_at: string
  updated_at: string
  proveedor: { legal_name: string; legacy_ref: string | null } | null
  autor: { full_name: string | null } | null
}

/**
 * ¿Este pedido tiene mercadería recibida?
 *
 * Es lo que decide si las líneas se congelan y si se puede cancelar. Se
 * pregunta a la base —hay una recepción confirmada con líneas de este
 * pedido— en vez de deducirlo de `receipt_status`: un pedido puede estar en
 * `pending` y tener una recepción en borrador, y eso no congela nada.
 */
async function tieneRecepcionConfirmada(companyId: string, pedidoId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('goods_receipts')
    .select('id')
    .eq('company_id', companyId)
    .eq('purchase_order_id', pedidoId)
    .eq('status', 'confirmed')
    .limit(1)
  if (error) throw new Error(`No se pudieron leer las recepciones: ${error.message}`)
  return (data ?? []).length > 0
}

export async function obtenerPedido(
  companyId: string,
  id: string,
): Promise<PedidoCompraDetalle | null> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select(COLUMNAS_DETALLE)
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el pedido: ${error.message}`)
  if (!data) return null

  const f = data as unknown as FilaDetalle
  const conRecepcion = await tieneRecepcionConfirmada(companyId, id)

  return {
    id: f.id,
    numero: f.number,
    serie: f.series_code,
    estado: f.status,
    estadoRecepcion: f.receipt_status,
    proveedorId: f.supplier_id,
    proveedor: f.proveedor?.legal_name ?? '(proveedor no accesible)',
    proveedorReferencia: f.proveedor?.legacy_ref ?? null,
    moneda: f.currency_code,
    tipoCambio: aNumeroONulo(f.exchange_rate),
    fecha: f.order_date,
    fechaEstimada: f.expected_date,
    formaPago: f.payment_terms,
    notas: f.notes,
    subtotal: aNumero(f.subtotal),
    impuesto: aNumero(f.tax_amount),
    total: aNumero(f.total),
    autor: f.autor?.full_name ?? null,
    creadoEn: f.created_at,
    actualizadoEn: f.updated_at,
    conRecepcion,
  }
}

export async function lineasDePedido(
  companyId: string,
  pedidoId: string,
): Promise<LineaPedidoCompra[]> {
  const { data, error } = await supabase
    .from('purchase_order_lines')
    .select(
      `id, line_no, line_type, product_id, sku_snapshot, name_snapshot,
       description_snapshot, quantity, unit_price, discount_pct, tax_treatment,
       tax_rate_snapshot, line_total`,
    )
    .eq('company_id', companyId)
    .eq('purchase_order_id', pedidoId)
    .order('line_no', { ascending: true })
  if (error) throw new Error(`No se pudieron leer las líneas: ${error.message}`)

  return (data ?? []).map((l) => ({
    id: l.id,
    numeroLinea: l.line_no,
    tipoLinea: l.line_type === 'chapter' ? 'chapter' : 'product',
    productId: l.product_id,
    sku: l.sku_snapshot,
    nombre: l.name_snapshot,
    descripcion: l.description_snapshot,
    cantidad: aNumero(l.quantity),
    precioUnitario: aNumeroONulo(l.unit_price),
    descuentoPct: aNumero(l.discount_pct),
    tratamientoImpuesto: l.tax_treatment,
    tasaImpuesto: aNumeroONulo(l.tax_rate_snapshot),
    netoServidor: aNumero(l.line_total),
  }))
}

/**
 * Qué cuelga del pedido.
 *
 * Recepciones y facturas de proveedor. Hoy dan cero en todos porque el
 * circuito no tiene pantalla todavía; se cuentan contra las tablas reales,
 * no se devuelve un cero escrito a mano.
 */
export async function relacionadosDePedido(
  companyId: string,
  pedidoId: string,
): Promise<RelacionadosPedido> {
  const { count: recepciones, error: eR } = await supabase
    .from('goods_receipts')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('purchase_order_id', pedidoId)
  if (eR) throw new Error(`No se pudieron contar las recepciones: ${eR.message}`)

  // Una factura de proveedor no cuelga del pedido por FK en la cabecera —eso
  // se decidió en la entrega 1—: se llega por las líneas.
  const { data: lineas, error: eL } = await supabase
    .from('purchase_order_lines')
    .select('id')
    .eq('company_id', companyId)
    .eq('purchase_order_id', pedidoId)
  if (eL) throw new Error(`No se pudieron leer las líneas: ${eL.message}`)

  const ids = (lineas ?? []).map((l) => l.id)
  let facturas = 0
  if (ids.length > 0) {
    const { data: fl, error: eF } = await supabase
      .from('supplier_invoice_lines')
      .select('supplier_invoice_id')
      .eq('company_id', companyId)
      .in('purchase_order_line_id', ids)
    if (eF) throw new Error(`No se pudieron contar las facturas: ${eF.message}`)
    facturas = new Set((fl ?? []).map((x) => x.supplier_invoice_id)).size
  }

  return { recepciones: recepciones ?? 0, facturas }
}

// ── Escritura ──────────────────────────────────────────────────────────────

function filaLinea(
  companyId: string,
  pedidoId: string,
  l: LineaPedidoCompra,
  lineNo: number,
) {
  const capitulo = l.tipoLinea === 'chapter'
  return {
    company_id: companyId,
    purchase_order_id: pedidoId,
    line_no: lineNo,
    line_type: l.tipoLinea,
    product_id: l.productId,
    sku_snapshot: l.sku?.trim() || null,
    name_snapshot: l.nombre?.trim() || null,
    description_snapshot: l.descripcion?.trim() || null,
    // Un capítulo no suma: el trigger de totales lo excluye por `line_type`,
    // pero además se guarda en cero para que no confunda a nadie que lea la
    // tabla.
    quantity: capitulo ? 1 : l.cantidad,
    unit_price: capitulo ? 0 : l.precioUnitario,
    discount_pct: capitulo ? 0 : l.descuentoPct,
    tax_treatment: capitulo ? 'not_taxed' : l.tratamientoImpuesto,
    // Se manda `null` salvo en `other`: así la pone
    // `app.tasa_de_tratamiento()` del lado del servidor y el 1 % del legacy
    // no se puede reproducir ni a mano.
    tax_rate_snapshot: l.tratamientoImpuesto === 'other' ? l.tasaImpuesto : null,
  }
}

async function proximoNumero(companyId: string): Promise<string> {
  const { data, error } = await supabase.rpc('next_document_number', {
    p_company: companyId,
    p_doc_type: 'purchase_order',
  })
  if (error) throw new Error(`No se pudo obtener el número: ${traducir(error.message, error.code)}`)
  if (!data) throw new Error('La numeración no devolvió ningún número')
  return data
}

function cabecera(d: DatosPedidoCompra) {
  return {
    supplier_id: d.proveedorId,
    currency_code: d.moneda,
    exchange_rate: d.tipoCambio.trim() === '' ? null : Number(d.tipoCambio.replace(',', '.')),
    order_date: d.fecha,
    // ETA vacía = NULL. No se conoce es un dato, no un hueco que rellenar.
    expected_date: vacioANulo(d.fechaEstimada),
    payment_terms: vacioANulo(d.formaPago),
    notes: vacioANulo(d.notas),
  }
}

/**
 * Alta.
 *
 * El número se pide **antes** del insert. Si el insert falla, ese número se
 * pierde —queda un hueco— y está bien: repetir un número es peor que
 * saltearlo. Es la misma regla que en Ventas y en Proveedores.
 */
export async function crearPedido(
  companyId: string,
  d: DatosPedidoCompra,
  lineas: readonly LineaPedidoCompra[],
): Promise<{ id: string; numero: string }> {
  const numero = await proximoNumero(companyId)

  const { data, error } = await supabase
    .from('purchase_orders')
    .insert({ company_id: companyId, number: numero, series_code: 'PC', status: 'draft', ...cabecera(d) })
    .select('id, number')
    .single()
  if (error) throw new Error(traducir(error.message, error.code))

  if (lineas.length > 0) {
    const { error: eL } = await supabase
      .from('purchase_order_lines')
      .insert(lineas.map((l, i) => filaLinea(companyId, data.id, l, i + 1)))
    if (eL) throw new Error(`El pedido ${data.number} se creó pero las líneas no: ${eL.message}`)
  }

  // El evento `create` lo escribe `app.auditar_pedido_compra()`. No se llama
  // a la RPC desde acá: la auditoría de lo que importa no depende de que el
  // navegador se acuerde de pedirla.
  return { id: data.id, numero: data.number }
}

/**
 * Edición de la cabecera.
 *
 * Se manda sólo lo que el estado permite cambiar. Lo que igual llegue de más
 * lo rechaza `app.proteger_estado_pedido_compra()`; esto evita mandar un
 * cambio que va a fallar, no reemplaza a la guarda.
 */
export async function actualizarPedido(
  companyId: string,
  id: string,
  d: DatosPedidoCompra,
  puedeIdentidad: boolean,
): Promise<void> {
  const c = cabecera(d)
  const parche = puedeIdentidad
    ? c
    : {
        expected_date: c.expected_date,
        payment_terms: c.payment_terms,
        notes: c.notes,
      }

  const { error } = await supabase
    .from('purchase_orders')
    .update(parche)
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

/**
 * Reemplaza las líneas del pedido.
 *
 * Borra e inserta en vez de hacer un diff campo por campo: son pocas líneas,
 * el `line_no` es único por pedido y un diff parcial deja estados a medias si
 * falla en el medio. Los totales los rehace el trigger.
 *
 * Si el pedido tiene mercadería recibida, el trigger rechaza tanto el borrado
 * como el insert. La pantalla ya no ofrece editar, pero la que decide es la
 * base.
 */
export async function guardarLineas(
  companyId: string,
  pedidoId: string,
  lineas: readonly LineaPedidoCompra[],
): Promise<void> {
  const { error: eDel } = await supabase
    .from('purchase_order_lines')
    .delete()
    .eq('company_id', companyId)
    .eq('purchase_order_id', pedidoId)
  if (eDel) throw new Error(traducir(eDel.message, eDel.code))

  if (lineas.length === 0) return

  const { error } = await supabase
    .from('purchase_order_lines')
    .insert(lineas.map((l, i) => filaLinea(companyId, pedidoId, l, i + 1)))
  if (error) throw new Error(traducir(error.message, error.code))
}

/**
 * Confirmar.
 *
 * **No mueve stock.** El stock entra recién con la nota de entrada de
 * proveedor, y lo mueve `public.confirmar_recepcion()`. Confirmar un pedido
 * es una transición comercial: el pedido se le mandó al proveedor.
 *
 * El `.eq('status','draft')` hace la transición condicional en la base: si
 * dos personas confirman a la vez, una escribe la fila y la otra recibe cero
 * filas. Una sola transición real, sin bloqueos en la aplicación.
 */
export async function confirmarPedido(companyId: string, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .update({ status: 'confirmed' })
    .eq('company_id', companyId)
    .eq('id', id)
    .eq('status', 'draft')
    .select('id')
  if (error) throw new Error(traducir(error.message, error.code))
  return (data ?? []).length > 0
}

/**
 * Cancelar.
 *
 * Desde `draft` o desde `confirmed`, y **nunca** con mercadería recibida: ahí
 * ya hubo impacto operativo y lo rechaza el servidor con `restrict_violation`.
 */
export async function cancelarPedido(companyId: string, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .update({ status: 'cancelled' })
    .eq('company_id', companyId)
    .eq('id', id)
    .in('status', ['draft', 'confirmed'])
    .select('id')
  if (error) throw new Error(traducir(error.message, error.code))
  return (data ?? []).length > 0
}

/**
 * Duplicar.
 *
 * Va por RPC porque numerar y copiar tienen que pasar juntos. El duplicado
 * es un pedido NUEVO: uuid nuevo, número nuevo, `draft`, con las líneas y sus
 * snapshots. No hereda recepciones, ni facturas, ni la auditoría del
 * original.
 */
export async function duplicarPedido(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('duplicar_pedido_compra', { p_order: id })
  if (error) throw new Error(`No se pudo duplicar: ${traducir(error.message, error.code)}`)
  return data
}

/**
 * El error de Postgres, en castellano.
 *
 * Los `restrict_violation` de los triggers ya vienen con un mensaje escrito
 * para leer; lo que se traduce es lo que no.
 */
function traducir(mensaje: string, codigo?: string): string {
  if (codigo === '23001') return mensaje
  if (codigo === '23505' && mensaje.includes('number')) {
    return 'Ese número de pedido ya existe.'
  }
  if (codigo === '23503' && mensaje.includes('currency')) {
    return 'Esa moneda no existe en el sistema.'
  }
  if (codigo === '23502' && mensaje.includes('currency_code')) {
    return 'La moneda es obligatoria.'
  }
  if (codigo === '23502' && mensaje.includes('supplier_id')) {
    return 'El proveedor es obligatorio.'
  }
  if (codigo === '23514' && mensaje.includes('tax_treatment')) {
    return 'Ese tratamiento de impuesto no existe.'
  }
  if (codigo === '42501') {
    return 'No tenés permiso para hacer este cambio. Compras es de administradores y empleados.'
  }
  return mensaje
}
