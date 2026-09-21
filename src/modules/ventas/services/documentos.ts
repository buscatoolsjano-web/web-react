import { supabase } from '@/services/supabase/client'
import { separarMotivos } from '../lib/estados'
import { DOC_TYPE_DE } from '../lib/autoridad'
import type {
  DocumentoDetalle,
  DomicilioSnapshot,
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
  /** Sólo el detalle lo pide: el documento impreso lleva el CUIT del cliente. */
  tax_id?: string | null
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
  if (filtros.serie) q = q.eq('series_code', filtros.serie)
  // El origen es la FK al documento anterior. En cotizaciones no existe, así
  // que el filtro no se ofrece y acá tampoco se aplica.
  if (filtros.origen && c.fkOrigen) {
    q = filtros.origen === 'con' ? q.not(c.fkOrigen.columna, 'is', null) : q.is(c.fkOrigen.columna, null)
  }
  // «Pendiente de entrega» es del pedido y sale de su `fulfillment_status`.
  // Se pregunta por «distinto de entregado» y no por «igual a pendiente»
  // para que un futuro «entregado en parte» siga contando como pendiente.
  if (filtros.pendienteDeEntrega && tipo === 'pedido') {
    // Tipado como `string` a propósito, igual que `campoEstado`: con el nombre
    // literal, TypeScript lo busca en las TRES tablas del union y
    // `fulfillment_status` sólo existe en `sales_orders`.
    const campo: string = 'fulfillment_status'
    q = q.neq(campo, 'delivered')
  }

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
  // La tarifa con la que se cotizó (Fase 15 · E2). Sólo la cotización la
  // guarda, y el nombre viaja en la MISMA consulta: no agrega un viaje.
  // Fase 15 · E4: el pedido también guarda con qué tarifa se vendió.
  const tarifa = tipo === 'entrega' ? '' : ', tarifa:price_lists!price_list_id ( name, currency_code )'
  // Fase 17 · E3: el domicilio elegido en el pedido, en la MISMA consulta. La
  // cotización no tiene la columna y el remito ya tiene su snapshot.
  const entrega =
    tipo === 'pedido'
      ? 'entrega:customer_addresses!shipping_address_id ( street, city, state, postal_code, country_code, notes ),'
      : ''
  // Cada documento tiene los suyos: sólo la cotización lleva descuento
  // global, percepción y validez; la entrega no tiene forma de pago.
  const propios =
    tipo === 'cotizacion'
      ? ', payment_terms, valid_until, discount_pct, perception_pct, price_list_id'
      : tipo === 'pedido'
        ? // Fase 17 · E3: el pedido elige a qué domicilio se entrega, y el
          // remito lo congela al emitirse.
          ', payment_terms, discount_pct, perception_pct, price_list_id, shipping_address_id'
        : // El remito no tiene forma de pago; sí transporte y seguimiento.
          ', carrier, tracking, delivery_address_snapshot'
  // `external_source` distingue lo que vino de STEL de lo que emitió el ERP;
  // `created_at`/`updated_at` y quién creó el documento son la ficha técnica
  // que la pestaña Información muestra al pie. Son columnas de la MISMA
  // consulta: no agregan un viaje más.
  return `
    id, number, original_number, suspected_normalized_number, ${c.campoFecha},
    title, currency_code, exchange_rate, subtotal, tax_amount, total,
    ${c.campoEstado}${segundo}${propios}, needs_review, review_reason, number_outlier,
    series_code, imported_at, external_source, created_at, updated_at, notes,
    contact_id${c.tieneVendedor ? ', salesperson_id' : ''},
    customers!customer_id ( id, legal_name, trade_name, tax_id ),
    contacto:customer_contacts!contact_id ( full_name, role, email, phone ),${entrega}
    creador:profiles!created_by ( full_name )${vendedor}${origen}${tarifa}
  `
}

const COLUMNAS_LINEA: Record<TipoDocumento, string> = {
  cotizacion: `id, line_no, line_type, product_id, sku_snapshot, name_snapshot,
    description_snapshot, quantity, unit_price, discount_pct, tax_treatment,
    tax_rate_snapshot`,
  pedido: `id, line_no, line_type, product_id, sku_snapshot, name_snapshot,
    description_snapshot, quantity_ordered, unit_price, discount_pct,
    tax_treatment, tax_rate_snapshot`,
  // Fase 15 · E5: `delivery_lines` ya tiene `line_no` y descripción propia. El
  // orden dejó de ser el del `id`, que no era ningún orden. Los precios existen
  // desde Stage 3 y están en NULL en las 600 líneas históricas.
  entrega: `id, line_no, product_id, sku_snapshot, name_snapshot,
    description_snapshot, quantity, order_line_id, unit_price, discount_pct,
    tax_treatment, tax_rate_snapshot`,
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
    // Fase 15 · E5: el remito también tiene su número de línea. El índice sólo
    // queda de respaldo por si alguna línea histórica quedara sin numerar.
    numeroLinea: aNumero(f['line_no']) ?? indice + 1,
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
    payment_terms?: string | null
    valid_until?: string | null
    discount_pct?: number | string | null
    perception_pct?: number | string | null
    external_source: string | null
    created_at: string
    updated_at: string
    contacto: { full_name: string | null; role: string | null; email: string | null; phone: string | null } | null
    tarifa?: { name: string | null; currency_code: string | null } | null
    creador: { full_name: string | null } | null
  }

  const { data: lineas, error: errorLineas } = await supabase
    .from(c.lineas)
    .select(COLUMNAS_LINEA[tipo])
    .eq('company_id', companyId)
    .eq(c.fkLinea, id)
    .order('line_no', { ascending: true })
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
    clienteCuit: f.customers?.tax_id ?? null,
    contactoNombre: f.contacto?.full_name ?? null,
    contactoId: (f['contact_id'] as string | null) ?? null,
    vendedorId: (f['salesperson_id'] as string | null) ?? null,
    listaPrecioId: (f['price_list_id'] as string | null) ?? null,
    direccionEntregaId: (f['shipping_address_id'] as string | null) ?? null,
    listaPrecioNombre: f.tarifa?.name ?? null,
    contactoRol: f.contacto?.role ?? null,
    contactoEmail: f.contacto?.email ?? null,
    contactoTelefono: f.contacto?.phone ?? null,
    titulo: f.title,
    moneda: f.currency_code,
    tipoCambio: aNumero(f.exchange_rate),
    estado: aTexto(f[c.campoEstado]),
    estadoSecundario: tipo === 'pedido' ? aTexto(f['fulfillment_status']) : null,
    vendedor: f.vendedor?.full_name ?? null,
    serie: f.series_code,
    notas: f.notes,
    formaPago: f.payment_terms ?? null,
    // Fase 15 · E5: el remito sí sabe quién lo llevó y con qué seguimiento.
    transporte: (f['carrier'] as string | null) ?? null,
    seguimiento: (f['tracking'] as string | null) ?? null,
    // Fase 15 · E6: el domicilio congelado. Nunca se completa con el actual
    // del cliente: si no está, es que no se registró.
    domicilioEntrega: (f['delivery_address_snapshot'] as DomicilioSnapshot | null) ?? null,
    domicilioElegido: (f['entrega'] as DomicilioSnapshot | null) ?? null,
    validaHasta: f.valid_until ?? null,
    descuentoPct: aNumero(f.discount_pct),
    percepcionPct: aNumero(f.perception_pct),
    subtotal: aNumero(f.subtotal),
    impuesto: aNumero(f.tax_amount),
    total: aNumero(f.total),
    necesitaRevision: f.needs_review,
    motivosRevision: separarMotivos(f.review_reason),
    numeroFueraDeSerie: f.number_outlier,
    esHistorico: f.imported_at !== null,
    externalSource: f.external_source,
    creadoPor: f.creador?.full_name ?? null,
    creadoEn: f.created_at,
    actualizadoEn: f.updated_at,
    lineas: ((lineas ?? []) as unknown as FilaLinea[]).map((l, i) => aLinea(tipo, l, i)),
    origen:
      c.fkOrigen && f.origen
        ? { tipo: c.fkOrigen.tipo, id: f.origen.id, numero: f.origen.number }
        : null,
  }
}

/** Las monedas que existen de verdad en los documentos, para el filtro. */
/**
 * Las monedas y las series que este tipo de documento tiene EN USO.
 *
 * Las dos salen del mismo recorrido: antes esto leía `currency_code` de todas
 * las filas para quedarse con tres valores, y la serie habría sido un segundo
 * recorrido idéntico. Una consulta, dos filtros.
 *
 * Se ofrecen sólo los valores que existen: un desplegable con una serie que
 * no usó ningún documento deja al listado vacío sin explicar por qué.
 */
export async function facetasDeDocumentos(
  tipo: TipoDocumento,
  companyId: string,
): Promise<{ monedas: string[]; series: string[] }> {
  const { data, error } = await supabase
    .from(CONFIG[tipo].tabla)
    .select('currency_code, series_code')
    .eq('company_id', companyId)
  if (error) throw new Error(`No se pudieron leer las monedas y series: ${error.message}`)

  const monedas = new Set<string>()
  const series = new Set<string>()
  for (const f of (data ?? []) as { currency_code: string | null; series_code: string | null }[]) {
    if (f.currency_code) monedas.add(f.currency_code)
    if (f.series_code) series.add(f.series_code)
  }
  return { monedas: [...monedas].sort(), series: [...series].sort() }
}

/** Una serie configurada para un tipo de documento, con su autoridad. */
export interface SerieDeDocumento {
  codigo: string
  esPorDefecto: boolean
  /** `ERP` = se puede emitir desde acá. `STEL` = la numera el sistema anterior. */
  autoridad: 'ERP' | 'STEL'
}

/**
 * Las series configuradas para este tipo de documento (Fase 19 · E3).
 *
 * Va por RPC y no leyendo `document_sequences` porque esa tabla **no es
 * legible desde el navegador**: no tiene grant para `authenticated` ni ninguna
 * policy. `series_de_documento` es `security definer` y verifica la pertenencia
 * a la empresa adentro, antes de devolver una sola fila.
 */
export async function seriesDeDocumento(
  tipo: TipoDocumento,
  companyId: string,
): Promise<SerieDeDocumento[]> {
  const DOC_TYPE = { cotizacion: 'quote', pedido: 'sales_order', entrega: 'delivery' } as const
  const { data, error } = await supabase.rpc('series_de_documento', {
    p_company: companyId,
    p_doc_type: DOC_TYPE[tipo],
  })
  if (error) throw new Error(`No se pudieron leer las series: ${error.message}`)

  return ((data ?? []) as { series_code: string; is_default: boolean; authority: string }[]).map((f) => ({
    codigo: f.series_code,
    esPorDefecto: f.is_default,
    autoridad: f.authority === 'ERP' ? 'ERP' : 'STEL',
  }))
}

/**
 * La revisión de un documento, clasificada por el servidor (Fase 19 · E4).
 *
 * `review_reason` es la foto del día de la migración y se conserva intacta.
 * Lo que dice si un motivo **sigue pasando hoy** es la vista
 * `revision_de_documentos`, y esa definición vive en un solo lugar: la misma
 * que cuenta el inicio y los informes. Acá no se vuelve a decidir nada.
 */
export interface RevisionDeDocumento {
  /** Lo que marcó la migración, tal cual quedó guardado. */
  historicos: string[]
  /** Lo que todavía se puede demostrar con el documento de hoy. */
  activos: string[]
  /** Lo que el dato de hoy desmiente. */
  resueltos: string[]
  /** Lo que no se puede comprobar desde el documento. Nunca es «resuelto». */
  noVerificables: string[]
  /** `true` si queda algo activo o sin verificar. */
  requiereAtencion: boolean
}

export async function revisionDeDocumento(
  tipo: TipoDocumento,
  documentoId: string,
): Promise<RevisionDeDocumento> {
  const { data, error } = await supabase
    .from('revision_de_documentos')
    .select('historical_reasons, active_reasons, resolved_since_migration, unverifiable_reasons, requires_attention_now')
    .eq('doc_type', DOC_TYPE_DE[tipo])
    .eq('document_id', documentoId)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer la revisión del documento: ${error.message}`)

  return {
    historicos: data?.historical_reasons ?? [],
    activos: data?.active_reasons ?? [],
    resueltos: data?.resolved_since_migration ?? [],
    noVerificables: data?.unverifiable_reasons ?? [],
    requiereAtencion: data?.requires_attention_now ?? false,
  }
}

/**
 * La foto principal de cada producto, para el documento impreso (Fase 19 · E6).
 *
 * Se pide SÓLO cuando el formato lleva fotos: un documento sin fotos no paga
 * esta consulta. Devuelve la miniatura si existe —pesa menos y alcanza para
 * 16 mm de papel— y si no, la imagen original.
 */
export async function fotosDeProductos(
  companyId: string,
  productoIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(productoIds)]
  if (ids.length === 0) return new Map()

  const { data, error } = await supabase
    .from('product_images')
    .select('product_id, thumb_url, source_url, is_primary')
    .eq('company_id', companyId)
    .in('product_id', ids)
    .order('is_primary', { ascending: false })
  if (error) throw new Error(`No se pudieron leer las fotos: ${error.message}`)

  const fotos = new Map<string, string>()
  for (const f of (data ?? []) as {
    product_id: string
    thumb_url: string | null
    source_url: string | null
  }[]) {
    // La primera de cada producto gana: vienen ordenadas con la principal
    // adelante.
    if (fotos.has(f.product_id)) continue
    const url = f.thumb_url ?? f.source_url
    if (url) fotos.set(f.product_id, url)
  }
  return fotos
}
