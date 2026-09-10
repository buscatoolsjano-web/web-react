import { supabase } from '@/services/supabase/client'
import type {
  Deposito,
  EstadoRecepcionDoc,
  FiltrosRecepciones,
  LineaRecepcion,
  PaginaDeRecepciones,
  PendienteDeLinea,
  RecepcionDetalle,
} from '../types'

/**
 * Recepciones: notas de entrada de proveedor.
 *
 * Cuatro reglas que vienen del servidor y no de esta pantalla:
 *
 *   1. **El stock lo mueve `confirmar_recepcion()`, nadie más.** Un borrador
 *      no toca nada, y `stock_balances` lo mantiene el trigger
 *      `app.apply_stock_movement()` desde `stock_movements`. Acá no hay ni un
 *      UPDATE de saldo.
 *   2. **La sobre-recepción se rechaza**, no se recorta. Lo comprueba la
 *      función al confirmar, con las líneas del pedido bloqueadas.
 *   3. **Una recepción confirmada está congelada**: no se edita, no se vuelve
 *      a borrador, no se borra. Lo imponen triggers.
 *   4. **El número lo da `next_document_number`.** Jamás `MAX+1`.
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

// ── Depósitos ──────────────────────────────────────────────────────────────

/**
 * Los depósitos activos de la empresa.
 *
 * Se leen: no se hardcodea ni el código `PRIN` ni ningún uuid. Si hay uno solo
 * la pantalla lo preselecciona; si hay varios, se elige.
 */
export async function depositosActivos(companyId: string): Promise<Deposito[]> {
  const { data, error } = await supabase
    .from('warehouses')
    .select('id, code, name, is_default')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })
  if (error) throw new Error(`No se pudieron leer los depósitos: ${error.message}`)
  return (data ?? []).map((d) => ({
    id: d.id,
    codigo: d.code,
    nombre: d.name,
    esPorDefecto: d.is_default,
  }))
}

// ── Lo pendiente de un pedido ──────────────────────────────────────────────

/**
 * Qué falta recibir de un pedido, línea por línea.
 *
 * Va por `public.pendiente_de_pedido()`, que además devuelve **cuánto de eso
 * ya está anotado en otras recepciones en borrador**. Los borradores NO
 * reservan: la cuenta de lo pendiente mira sólo las recepciones confirmadas.
 * El dato del borrador se muestra para que quien recibe lo vea antes, no para
 * bloquear nada, y un borrador abandonado no inmoviliza mercadería.
 *
 * `stockActual` sale de `stock_balances` para el depósito elegido. Es lo que
 * hay hoy, no lo que va a haber.
 */
export async function pendienteDePedido(
  companyId: string,
  pedidoId: string,
  depositoId: string | null,
  excluirRecepcionId: string | null = null,
): Promise<PendienteDeLinea[]> {
  const { data, error } = await supabase.rpc('pendiente_de_pedido', {
    p_order: pedidoId,
    p_excluir_recepcion: excluirRecepcionId,
  })
  if (error) throw new Error(`No se pudo leer lo pendiente: ${error.message}`)

  const filas = ((data ?? []) as unknown as {
    purchase_order_line_id: string
    line_no: number
    product_id: string | null
    sku: string | null
    descripcion: string | null
    pedido: number | string
    recibido: number | string
    en_borrador: number | string
    pendiente: number | string
    borradores: string[] | null
  }[]).map((f) => ({
    purchaseOrderLineId: f.purchase_order_line_id,
    numeroLinea: f.line_no,
    productId: f.product_id,
    sku: f.sku,
    descripcion: f.descripcion,
    pedido: aNumero(f.pedido),
    recibido: aNumero(f.recibido),
    enBorrador: aNumero(f.en_borrador),
    pendiente: aNumero(f.pendiente),
    borradores: f.borradores ?? [],
    stockActual: null as number | null,
  }))

  const productos = filas.map((f) => f.productId).filter((x): x is string => x !== null)
  if (depositoId === null || productos.length === 0) return filas

  const { data: saldos, error: eS } = await supabase
    .from('stock_balances')
    .select('product_id, on_hand')
    .eq('company_id', companyId)
    .eq('warehouse_id', depositoId)
    .in('product_id', [...new Set(productos)])
  if (eS) throw new Error(`No se pudo leer el stock: ${eS.message}`)

  const porProducto = new Map((saldos ?? []).map((s) => [s.product_id, aNumero(s.on_hand)]))
  // Un producto sin fila de saldo tiene cero, no «desconocido»: la fila se
  // crea cuando entra el primer movimiento.
  return filas.map((f) =>
    f.productId === null ? f : { ...f, stockActual: porProducto.get(f.productId) ?? 0 },
  )
}

// ── Listado ────────────────────────────────────────────────────────────────

const COLUMNAS_LISTADO = `
  id, number, receipt_date, status, supplier_id, purchase_order_id, warehouse_id,
  proveedor:suppliers!supplier_id ( legal_name ),
  pedido:purchase_orders!purchase_order_id ( number ),
  deposito:warehouses!warehouse_id ( name ),
  autor:profiles!created_by ( full_name ),
  goods_receipt_lines ( id, quantity )
`

interface FilaListado {
  id: string
  number: string
  receipt_date: string
  status: EstadoRecepcionDoc
  supplier_id: string
  purchase_order_id: string | null
  warehouse_id: string
  proveedor: { legal_name: string } | null
  pedido: { number: string } | null
  deposito: { name: string } | null
  autor: { full_name: string | null } | null
  goods_receipt_lines: { id: string; quantity: number | string }[] | null
}

export async function listarRecepciones(
  companyId: string,
  filtros: FiltrosRecepciones,
): Promise<PaginaDeRecepciones> {
  let q = supabase
    .from('goods_receipts')
    .select(COLUMNAS_LISTADO, { count: 'exact' })
    .eq('company_id', companyId)

  // La coma y los paréntesis rompen la sintaxis de PostgREST.
  const texto = filtros.q.trim().replace(/[,()*]/g, '')
  if (texto !== '') q = q.ilike('number', `%${texto}%`)
  if (filtros.proveedorId) q = q.eq('supplier_id', filtros.proveedorId)
  if (filtros.pedidoId) q = q.eq('purchase_order_id', filtros.pedidoId)
  if (filtros.estado) q = q.eq('status', filtros.estado)
  if (filtros.depositoId) q = q.eq('warehouse_id', filtros.depositoId)
  if (filtros.desde) q = q.gte('receipt_date', filtros.desde)
  if (filtros.hasta) q = q.lte('receipt_date', filtros.hasta)

  const columna = {
    fecha: 'receipt_date',
    numero: 'number',
    proveedor: 'supplier_id',
    pedido: 'purchase_order_id',
  }[filtros.orden]
  const asc = filtros.direccion === 'asc'
  q = q.order(columna, { ascending: asc, nullsFirst: false })
  // Desempate estable: sin esto dos recepciones del mismo día pueden cambiar
  // de orden entre páginas y una fila sale dos veces o ninguna.
  if (columna !== 'number') q = q.order('number', { ascending: asc })

  const desde = (filtros.pagina - 1) * filtros.porPagina
  q = q.range(desde, desde + filtros.porPagina - 1)

  const { data, error, count } = await q
  if (error) throw new Error(`No se pudo leer el listado de recepciones: ${error.message}`)

  return {
    filas: ((data ?? []) as unknown as FilaListado[]).map((f) => ({
      id: f.id,
      numero: f.number,
      fecha: f.receipt_date,
      proveedorId: f.supplier_id,
      proveedor: f.proveedor?.legal_name ?? '(proveedor no accesible)',
      pedidoId: f.purchase_order_id,
      pedidoNumero: f.pedido?.number ?? null,
      depositoId: f.warehouse_id,
      deposito: f.deposito?.name ?? '—',
      estado: f.status,
      lineas: (f.goods_receipt_lines ?? []).length,
      unidades: (f.goods_receipt_lines ?? []).reduce((a, l) => a + aNumero(l.quantity), 0),
      autor: f.autor?.full_name ?? null,
    })),
    total: count ?? 0,
  }
}

// ── Ficha ──────────────────────────────────────────────────────────────────

const COLUMNAS_DETALLE = `
  id, number, series_code, status, receipt_date, supplier_id, purchase_order_id,
  warehouse_id, supplier_document, notes, confirmed_at, created_at,
  proveedor:suppliers!supplier_id ( legal_name ),
  pedido:purchase_orders!purchase_order_id ( number ),
  deposito:warehouses!warehouse_id ( name ),
  autor:profiles!created_by ( full_name ),
  confirmador:profiles!confirmed_by ( full_name )
`

export async function obtenerRecepcion(
  companyId: string,
  id: string,
): Promise<RecepcionDetalle | null> {
  const { data, error } = await supabase
    .from('goods_receipts')
    .select(COLUMNAS_DETALLE)
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer la recepción: ${error.message}`)
  if (!data) return null

  const f = data as unknown as {
    id: string
    number: string
    series_code: string
    status: EstadoRecepcionDoc
    receipt_date: string
    supplier_id: string
    purchase_order_id: string | null
    warehouse_id: string
    supplier_document: string | null
    notes: string | null
    confirmed_at: string | null
    created_at: string
    proveedor: { legal_name: string } | null
    pedido: { number: string } | null
    deposito: { name: string } | null
    autor: { full_name: string | null } | null
    confirmador: { full_name: string | null } | null
  }

  return {
    id: f.id,
    numero: f.number,
    serie: f.series_code,
    estado: f.status,
    fecha: f.receipt_date,
    proveedorId: f.supplier_id,
    proveedor: f.proveedor?.legal_name ?? '(proveedor no accesible)',
    pedidoId: f.purchase_order_id,
    pedidoNumero: f.pedido?.number ?? null,
    depositoId: f.warehouse_id,
    deposito: f.deposito?.name ?? '—',
    documentoProveedor: f.supplier_document,
    notas: f.notes,
    autor: f.autor?.full_name ?? null,
    confirmadaEn: f.confirmed_at,
    confirmadaPor: f.confirmador?.full_name ?? null,
    creadoEn: f.created_at,
  }
}

export async function lineasDeRecepcion(
  companyId: string,
  recepcionId: string,
): Promise<LineaRecepcion[]> {
  const { data, error } = await supabase
    .from('goods_receipt_lines')
    .select('id, purchase_order_line_id, product_id, sku_snapshot, name_snapshot, quantity')
    .eq('company_id', companyId)
    .eq('goods_receipt_id', recepcionId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`No se pudieron leer las líneas: ${error.message}`)

  return (data ?? []).map((l) => ({
    id: l.id,
    purchaseOrderLineId: l.purchase_order_line_id,
    productId: l.product_id,
    sku: l.sku_snapshot,
    descripcion: l.name_snapshot,
    cantidad: aNumero(l.quantity),
  }))
}

// ── Escritura ──────────────────────────────────────────────────────────────

export interface DatosRecepcion {
  pedidoId: string
  proveedorId: string
  depositoId: string
  fecha: string
  documentoProveedor: string
  notas: string
}

/** Lo que se va a recibir de cada línea del pedido. */
export interface CantidadARecibir {
  purchaseOrderLineId: string
  productId: string | null
  sku: string | null
  descripcion: string | null
  cantidad: number
}

async function proximoNumero(companyId: string): Promise<string> {
  const { data, error } = await supabase.rpc('next_document_number', {
    p_company: companyId,
    p_doc_type: 'goods_receipt',
  })
  if (error) throw new Error(`No se pudo obtener el número: ${traducir(error.message, error.code)}`)
  if (!data) throw new Error('La numeración no devolvió ningún número')
  return data
}

/**
 * Crea la recepción en borrador.
 *
 * **No mueve stock.** Nace en `draft` y ahí se queda hasta que alguien la
 * confirme, que es otra acción y otro botón.
 *
 * El número se pide antes del insert: si el insert falla, ese número se pierde
 * y queda un hueco. Repetir un número es peor que saltearlo.
 */
export async function crearRecepcion(
  companyId: string,
  d: DatosRecepcion,
  lineas: readonly CantidadARecibir[],
): Promise<{ id: string; numero: string }> {
  const conCantidad = lineas.filter((l) => l.cantidad > 0)
  if (conCantidad.length === 0) {
    throw new Error('No hay ninguna cantidad cargada: una recepción vacía no es una recepción.')
  }

  const numero = await proximoNumero(companyId)

  const { data, error } = await supabase
    .from('goods_receipts')
    .insert({
      company_id: companyId,
      supplier_id: d.proveedorId,
      purchase_order_id: d.pedidoId,
      warehouse_id: d.depositoId,
      number: numero,
      series_code: 'NEP',
      status: 'draft',
      receipt_date: d.fecha,
      supplier_document: vacioANulo(d.documentoProveedor),
      notes: vacioANulo(d.notas),
    })
    .select('id, number')
    .single()
  if (error) throw new Error(traducir(error.message, error.code))

  const { error: eL } = await supabase.from('goods_receipt_lines').insert(
    conCantidad.map((l) => ({
      company_id: companyId,
      goods_receipt_id: data.id,
      purchase_order_line_id: l.purchaseOrderLineId,
      product_id: l.productId,
      sku_snapshot: l.sku,
      name_snapshot: l.descripcion,
      quantity: l.cantidad,
    })),
  )
  if (eL) {
    // La cabecera quedó sin líneas: se borra para no dejar un documento vacío
    // con un número gastado. Es un borrador, así que se puede.
    await supabase.from('goods_receipts').delete().eq('id', data.id)
    throw new Error(traducir(eL.message, eL.code))
  }

  return { id: data.id, numero: data.number }
}

/** Cabecera de un borrador. Una recepción confirmada no llega acá: el trigger la frena. */
export async function actualizarRecepcion(
  companyId: string,
  id: string,
  d: Pick<DatosRecepcion, 'depositoId' | 'fecha' | 'documentoProveedor' | 'notas'>,
): Promise<void> {
  const { error } = await supabase
    .from('goods_receipts')
    .update({
      warehouse_id: d.depositoId,
      receipt_date: d.fecha,
      supplier_document: vacioANulo(d.documentoProveedor),
      notes: vacioANulo(d.notas),
    })
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

/**
 * Reemplaza las líneas de un borrador.
 *
 * Borra e inserta en vez de hacer un diff: son pocas líneas y un diff parcial
 * deja estados a medias si falla en el medio.
 */
export async function guardarLineasRecepcion(
  companyId: string,
  recepcionId: string,
  lineas: readonly CantidadARecibir[],
): Promise<void> {
  const conCantidad = lineas.filter((l) => l.cantidad > 0)
  if (conCantidad.length === 0) {
    throw new Error('No hay ninguna cantidad cargada: una recepción vacía no es una recepción.')
  }

  const { error: eDel } = await supabase
    .from('goods_receipt_lines')
    .delete()
    .eq('company_id', companyId)
    .eq('goods_receipt_id', recepcionId)
  if (eDel) throw new Error(traducir(eDel.message, eDel.code))

  const { error } = await supabase.from('goods_receipt_lines').insert(
    conCantidad.map((l) => ({
      company_id: companyId,
      goods_receipt_id: recepcionId,
      purchase_order_line_id: l.purchaseOrderLineId,
      product_id: l.productId,
      sku_snapshot: l.sku,
      name_snapshot: l.descripcion,
      quantity: l.cantidad,
    })),
  )
  if (error) throw new Error(traducir(error.message, error.code))
}

/** Borra un borrador. Una recepción confirmada no se borra: la frena el trigger. */
export async function borrarRecepcion(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('goods_receipts')
    .delete()
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

export interface ResultadoConfirmacion {
  yaEstaba: boolean
  movimientos: number
  estadoPedido: string | null
}

/**
 * Confirmar.
 *
 * **Es lo único que mueve stock.** Todo pasa del lado del servidor y en una
 * sola transacción: bloquea las líneas del pedido, valida lo pendiente,
 * inserta los movimientos, marca la recepción, deriva el `receipt_status` del
 * pedido y audita. Si una línea falla, no entra ninguna.
 *
 * Es idempotente: dos clicks, dos pestañas o un refresh devuelven
 * `yaEstaba: true` y el stock sube una sola vez.
 */
export async function confirmarRecepcion(id: string): Promise<ResultadoConfirmacion> {
  const { data, error } = await supabase.rpc('confirmar_recepcion', { p_receipt: id })
  if (error) throw new Error(traducir(error.message, error.code))
  const r = data as unknown as {
    ya_estaba: boolean
    movimientos: number
    receipt_status_pedido: string | null
  }
  return {
    yaEstaba: r.ya_estaba,
    movimientos: r.movimientos,
    estadoPedido: r.receipt_status_pedido,
  }
}

/**
 * El error de Postgres, en castellano.
 *
 * Los mensajes de los triggers ya están escritos para leerse —«se intenta
 * recibir 31 y quedan 30 pendientes»—; lo que se traduce es lo demás.
 */
function traducir(mensaje: string, codigo?: string): string {
  if (codigo === '23001' || codigo === '23514') return mensaje
  if (codigo === '23505' && mensaje.includes('goods_receipt_id')) {
    return 'Esa línea del pedido ya está cargada una vez en esta recepción.'
  }
  if (codigo === '23505' && mensaje.includes('number')) {
    return 'Ese número de recepción ya existe.'
  }
  if (codigo === '23502' && mensaje.includes('warehouse_id')) {
    return 'El depósito es obligatorio.'
  }
  if (codigo === '42501') {
    return 'No tenés permiso para hacer este cambio. Compras es de administradores y empleados.'
  }
  return mensaje
}
