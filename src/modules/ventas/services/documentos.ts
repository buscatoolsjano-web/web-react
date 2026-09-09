import { supabase } from '@/services/supabase/client'
import { separarMotivos } from '../lib/estados'
import type {
  DocumentoDetalle,
  DocumentoListado,
  LineaDocumento,
  PaginaDeDocumentos,
  TipoDocumento,
  FiltrosVentas,
} from '../types'

/**
 * Los tres documentos difieren en el nombre de la tabla, el de la fecha y el
 * del estado. Todo lo demás es igual, así que se describe una vez.
 *
 * Los nombres de tabla van tipados como literales y no como `string`:
 * `supabase.from()` está sobrecargado por nombre de tabla, y con un `string`
 * suelto la inferencia se cae entera y todo lo que sigue queda en `never`.
 */
type TablaDocumento = 'sales_quotes' | 'sales_orders' | 'deliveries'
type TablaLinea = 'sales_quote_lines' | 'sales_order_lines' | 'delivery_lines'

interface Config {
  tabla: TablaDocumento
  lineas: TablaLinea
  fkLinea: string
  campoFecha: string
  campoEstado: string
  /**
   * `deliveries` NO tiene `salesperson_id`: el vendedor es del pedido, no del
   * remito. Pedir el embed igual devuelve un error de PostgREST, no un null.
   */
  tieneVendedor: boolean
  /** Columna por la que se enlaza el documento de origen. */
  fkOrigen: { columna: string; tabla: string; tipo: TipoDocumento } | null
}

const CONFIG: Record<TipoDocumento, Config> = {
  cotizacion: {
    tabla: 'sales_quotes',
    lineas: 'sales_quote_lines',
    fkLinea: 'quote_id',
    campoFecha: 'quote_date',
    campoEstado: 'status',
    tieneVendedor: true,
    fkOrigen: null,
  },
  pedido: {
    tabla: 'sales_orders',
    lineas: 'sales_order_lines',
    fkLinea: 'order_id',
    campoFecha: 'order_date',
    campoEstado: 'commercial_status',
    tieneVendedor: true,
    fkOrigen: { columna: 'quote_id', tabla: 'sales_quotes', tipo: 'cotizacion' },
  },
  entrega: {
    tabla: 'deliveries',
    lineas: 'delivery_lines',
    fkLinea: 'delivery_id',
    campoFecha: 'delivery_date',
    campoEstado: 'status',
    tieneVendedor: false,
    fkOrigen: { columna: 'order_id', tabla: 'sales_orders', tipo: 'pedido' },
  },
}

/** Un cliente puede tener razón social y nombre de fantasía; se prefiere el segundo. */
interface FilaCliente {
  id: string
  legal_name: string | null
  trade_name: string | null
}

function nombreCliente(c: FilaCliente | null): string {
  return c?.trade_name?.trim() || c?.legal_name?.trim() || 'Sin cliente'
}

/**
 * Columnas del listado. Nunca `select('*')`.
 *
 * `title`, `total` y `currency_code` los agregó la migración; `series_code`,
 * Stage 2.5. `imported_at` distingue el histórico del documento nuevo, y de
 * eso depende que la cabecera se recalcule o se respete.
 */
function columnasListado(tipo: TipoDocumento): string {
  const c = CONFIG[tipo]
  // El hint `!columna` no es opcional: `customers` y `profiles` están
  // referenciadas por más de una FK y sin él PostgREST devuelve PGRST201.
  const origen = c.fkOrigen ? `, origen:${c.fkOrigen.tabla}!${c.fkOrigen.columna} ( id, number )` : ''
  const vendedor = c.tieneVendedor ? ', vendedor:profiles!salesperson_id ( full_name )' : ''
  const segundo = tipo === 'pedido' ? ', fulfillment_status' : ''
  return `
    id, number, original_number, ${c.campoFecha}, title, currency_code, total,
    ${c.campoEstado}${segundo}, needs_review, review_reason, number_outlier,
    series_code, imported_at,
    customers!customer_id ( id, legal_name, trade_name )${vendedor}${origen}
  `
}

/** PostgREST devuelve las columnas dinámicas, así que la fila es un mapa. */
type FilaCruda = Record<string, unknown> & {
  id: string
  number: string
  original_number: string | null
  title: string | null
  currency_code: string | null
  total: number | string | null
  needs_review: boolean
  review_reason: string | null
  number_outlier: boolean
  series_code: string | null
  imported_at: string | null
  customers: FilaCliente | null
  vendedor?: { full_name: string | null } | null
  origen?: { id: string; number: string } | null
}

/** Las columnas dinámicas llegan sin tipo; esto las estrecha sin castear. */
function aTexto(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function aNumero(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function aFila(tipo: TipoDocumento, f: FilaCruda): DocumentoListado {
  const c = CONFIG[tipo]
  return {
    id: f.id,
    tipo,
    // Para el histórico `number` y `original_number` son el mismo valor: la
    // migración conservó el número literal. Se muestra el original cuando
    // existe, para que lo que se ve en pantalla sea lo que estaba en el legacy.
    numero: f.original_number ?? f.number,
    fecha: aTexto(f[c.campoFecha]),
    clienteId: f.customers?.id ?? null,
    clienteNombre: nombreCliente(f.customers),
    titulo: f.title,
    moneda: f.currency_code,
    total: aNumero(f.total),
    estado: aTexto(f[c.campoEstado]),
    estadoSecundario: tipo === 'pedido' ? aTexto(f['fulfillment_status']) : null,
    vendedor: f.vendedor?.full_name ?? null,
    serie: f.series_code,
    origen: f.origen?.number ?? null,
    necesitaRevision: f.needs_review,
    motivosRevision: separarMotivos(f.review_reason),
    numeroFueraDeSerie: f.number_outlier,
    esHistorico: f.imported_at !== null,
  }
}

/**
 * Una página del listado.
 *
 * Todo del lado del servidor: filtros, orden, paginación y el total exacto.
 * El legacy traía los 636 documentos al navegador para mostrar 10.
 */
export async function listarDocumentos(
  tipo: TipoDocumento,
  companyId: string,
  filtros: FiltrosVentas,
): Promise<PaginaDeDocumentos> {
  const c = CONFIG[tipo]
  let q = supabase
    .from(c.tabla)
    .select(columnasListado(tipo), { count: 'exact' })
    .eq('company_id', companyId)

  const texto = filtros.q.trim()
  if (texto !== '') {
    // Busca en los dos números: el `number` y el original del legacy. El
    // escape de la coma importa — PostgREST la usa como separador de `or`.
    const patron = `%${texto.replace(/[,()]/g, '')}%`
    q = q.or(`number.ilike.${patron},original_number.ilike.${patron}`)
  }
  if (filtros.clienteId) q = q.eq('customer_id', filtros.clienteId)
  if (filtros.estado) q = q.eq(c.campoEstado, filtros.estado)
  if (filtros.moneda) q = q.eq('currency_code', filtros.moneda)
  if (filtros.desde) q = q.gte(c.campoFecha, filtros.desde)
  if (filtros.hasta) q = q.lte(c.campoFecha, filtros.hasta)
  if (filtros.soloRevision) q = q.eq('needs_review', true)

  const columnaOrden = {
    fecha: c.campoFecha,
    numero: 'number',
    cliente: 'customer_id',
    total: 'total',
  }[filtros.orden]
  const asc = filtros.direccion === 'asc'
  q = q.order(columnaOrden, { ascending: asc, nullsFirst: false })
  // Desempate estable: sin esto dos documentos de la misma fecha pueden
  // cambiar de orden entre páginas y una fila aparece dos veces o ninguna.
  if (columnaOrden !== 'number') q = q.order('number', { ascending: asc })

  const desde = (filtros.pagina - 1) * filtros.porPagina
  q = q.range(desde, desde + filtros.porPagina - 1)

  const { data, error, count } = await q
  if (error) throw new Error(`No se pudo leer ${c.tabla}: ${error.message}`)

  return {
    filas: ((data ?? []) as unknown as FilaCruda[]).map((f) => aFila(tipo, f)),
    total: count ?? 0,
  }
}

// ── Detalle ────────────────────────────────────────────────────────────────

function columnasDetalle(tipo: TipoDocumento): string {
  const c = CONFIG[tipo]
  const origen = c.fkOrigen ? `, origen:${c.fkOrigen.tabla}!${c.fkOrigen.columna} ( id, number )` : ''
  const vendedor = c.tieneVendedor ? ', vendedor:profiles!salesperson_id ( full_name )' : ''
  const segundo = tipo === 'pedido' ? ', fulfillment_status' : ''
  return `
    id, number, original_number, suspected_normalized_number, ${c.campoFecha},
    title, currency_code, exchange_rate, subtotal, tax_amount, total,
    ${c.campoEstado}${segundo}, needs_review, review_reason, number_outlier,
    series_code, imported_at, notes,
    customers!customer_id ( id, legal_name, trade_name ),
    contacto:customer_contacts!contact_id ( full_name )${vendedor}${origen}
  `
}

const COLUMNAS_LINEA: Record<TipoDocumento, string> = {
  cotizacion: `id, line_no, line_type, product_id, sku_snapshot, name_snapshot,
    description_snapshot, quantity, unit_price, discount_pct, tax_treatment,
    tax_rate_snapshot`,
  pedido: `id, line_no, line_type, product_id, sku_snapshot, name_snapshot,
    description_snapshot, quantity_ordered, unit_price, discount_pct,
    tax_treatment, tax_rate_snapshot`,
  // `delivery_lines` no tiene `line_no` ni descripción: el legacy nunca los
  // guardó. Los precios existen desde Stage 3 y están en NULL en las 600
  // líneas históricas.
  entrega: `id, product_id, sku_snapshot, name_snapshot, quantity, order_line_id,
    unit_price, discount_pct, tax_treatment, tax_rate_snapshot`,
}

type FilaLinea = Record<string, unknown> & {
  id: string
  product_id: string | null
  sku_snapshot: string | null
  name_snapshot: string | null
  tax_treatment: string | null
}

function aLinea(tipo: TipoDocumento, f: FilaLinea, indice: number): LineaDocumento {
  const cantidad = tipo === 'pedido' ? f['quantity_ordered'] : f['quantity']
  return {
    id: f.id,
    // La entrega no tiene número de línea en el modelo; se usa el orden de
    // llegada sólo para mostrar, nunca para relacionar nada.
    numeroLinea: tipo === 'entrega' ? indice + 1 : (aNumero(f['line_no']) ?? null),
    tipoLinea: (f['line_type'] as LineaDocumento['tipoLinea']) ?? 'item',
    productId: f.product_id,
    sku: f.sku_snapshot,
    nombre: f.name_snapshot,
    descripcion: (f['description_snapshot'] as string | null) ?? null,
    cantidad: aNumero(cantidad) ?? 0,
    precioUnitario: aNumero(f['unit_price']),
    descuentoPct: aNumero(f['discount_pct']),
    tratamientoImpuesto: f.tax_treatment,
    tasaImpuesto: aNumero(f['tax_rate_snapshot']),
    ordenLineaId: (f['order_line_id'] as string | null) ?? null,
  }
}

export async function obtenerDocumento(
  tipo: TipoDocumento,
  companyId: string,
  id: string,
): Promise<DocumentoDetalle | null> {
  const c = CONFIG[tipo]

  const { data, error } = await supabase
    .from(c.tabla)
    .select(columnasDetalle(tipo))
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el documento: ${error.message}`)
  if (!data) return null

  const f = data as unknown as FilaCruda & {
    suspected_normalized_number: string | null
    subtotal: number | string | null
    tax_amount: number | string | null
    exchange_rate: number | string | null
    notes: string | null
    contacto: { full_name: string | null } | null
  }

  const { data: lineas, error: errorLineas } = await supabase
    .from(c.lineas)
    .select(COLUMNAS_LINEA[tipo])
    .eq('company_id', companyId)
    .eq(c.fkLinea, id)
    .order(tipo === 'entrega' ? 'id' : 'line_no', { ascending: true })
  if (errorLineas) throw new Error(`No se pudieron leer las líneas: ${errorLineas.message}`)

  return {
    id: f.id,
    tipo,
    numero: f.original_number ?? f.number,
    numeroOriginal: f.original_number,
    numeroSospechado: f.suspected_normalized_number,
    fecha: aTexto(f[c.campoFecha]),
    clienteId: f.customers?.id ?? null,
    clienteNombre: nombreCliente(f.customers),
    contactoNombre: f.contacto?.full_name ?? null,
    titulo: f.title,
    moneda: f.currency_code,
    tipoCambio: aNumero(f.exchange_rate),
    estado: aTexto(f[c.campoEstado]),
    estadoSecundario: tipo === 'pedido' ? aTexto(f['fulfillment_status']) : null,
    vendedor: f.vendedor?.full_name ?? null,
    serie: f.series_code,
    notas: f.notes,
    subtotal: aNumero(f.subtotal),
    impuesto: aNumero(f.tax_amount),
    total: aNumero(f.total),
    necesitaRevision: f.needs_review,
    motivosRevision: separarMotivos(f.review_reason),
    numeroFueraDeSerie: f.number_outlier,
    esHistorico: f.imported_at !== null,
    lineas: ((lineas ?? []) as unknown as FilaLinea[]).map((l, i) => aLinea(tipo, l, i)),
    origen:
      c.fkOrigen && f.origen
        ? { tipo: c.fkOrigen.tipo, id: f.origen.id, numero: f.origen.number }
        : null,
  }
}

/** Las monedas que existen de verdad en los documentos, para el filtro. */
export async function monedasUsadas(
  tipo: TipoDocumento,
  companyId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from(CONFIG[tipo].tabla)
    .select('currency_code')
    .eq('company_id', companyId)
    .not('currency_code', 'is', null)
  if (error) throw new Error(`No se pudieron leer las monedas: ${error.message}`)

  const set = new Set<string>()
  for (const f of (data ?? []) as { currency_code: string | null }[]) {
    if (f.currency_code) set.add(f.currency_code)
  }
  return [...set].sort()
}
