import { supabase } from '@/services/supabase/client'
import type {
  CandidatoDeOc,
  ClienteDetalle,
  ClienteListado,
  ContactoCliente,
  DireccionCliente,
  DocumentoDeCliente,
  FiltrosClientes,
  PaginaDeClientes,
  PaginaDeDocumentos,
} from '../types'

/**
 * Lectura del maestro de clientes.
 *
 * Todo del lado del servidor. El legacy tenía los 988 clientes en memoria y
 * filtraba con `_clientes_applyFilters` sobre el array entero para mostrar
 * 25; con 1.010 filas eso ya son unos cuantos megas de JSON por pantalla.
 *
 * Lo que se puede leer lo decide RLS, no este archivo: un rol externo ve su
 * propia ficha y nada más, y el listado le vuelve con una fila o con ninguna.
 */

/** Columnas del listado. Nunca `select('*')`. */
const COLUMNAS_LISTADO = `
  id, legacy_ref, legal_name, trade_name, tax_id, emails, email_domains,
  industry, phone, imported_at, needs_review, review_reason, deleted_at
`

interface FilaListado {
  id: string
  legacy_ref: string | null
  legal_name: string
  trade_name: string | null
  tax_id: string | null
  emails: string[] | null
  email_domains: string[] | null
  industry: string | null
  phone: string | null
  imported_at: string | null
  needs_review: boolean
  review_reason: string | null
  deleted_at: string | null
}

/** `A | B | C` → `['A','B','C']`. Vacío o nulo, lista vacía. */
export function separarMotivos(texto: string | null): string[] {
  if (!texto) return []
  return texto
    .split('|')
    .map((m) => m.trim())
    .filter((m) => m !== '')
}

function aFila(f: FilaListado): ClienteListado {
  return {
    id: f.id,
    referencia: f.legacy_ref,
    razonSocial: f.legal_name,
    nombreComercial: f.trade_name,
    cuit: f.tax_id,
    emails: f.emails ?? [],
    dominios: f.email_domains ?? [],
    rubro: f.industry,
    telefono: f.phone,
    esHistorico: f.imported_at !== null,
    necesitaRevision: f.needs_review,
    motivosRevision: separarMotivos(f.review_reason),
    dadoDeBaja: f.deleted_at !== null,
  }
}

/**
 * Búsqueda libre.
 *
 * Busca en razón social, nombre comercial, referencia y CUIT. Los emails y
 * los dominios son arrays y no entran en un `ilike`, así que se resuelven
 * aparte con `cs` (contains) cuando el texto parece uno de los dos.
 *
 * La coma y los paréntesis se sacan del patrón: PostgREST usa la coma para
 * separar las condiciones de un `or` y el texto se le mete adentro.
 */
function condicionDeBusqueda(texto: string): string | null {
  const limpio = texto.trim().replace(/[,()*]/g, '')
  if (limpio === '') return null
  const patron = `%${limpio}%`
  // El CUIT se guarda con guiones o sin ellos según de dónde vino, así que se
  // busca también por los dígitos sueltos.
  const digitos = limpio.replace(/\D/g, '')
  const condiciones = [
    `legal_name.ilike.${patron}`,
    `trade_name.ilike.${patron}`,
    `legacy_ref.ilike.${patron}`,
    `tax_id.ilike.${patron}`,
    `legacy_name.ilike.${patron}`,
  ]
  if (digitos.length >= 8) condiciones.push(`tax_id.ilike.%${digitos}%`)
  if (limpio.includes('@') || limpio.includes('.')) {
    // `emails` y `email_domains` son text[]: se pregunta por pertenencia
    // exacta del valor en minúsculas, que es como los guardó la migración.
    const valor = limpio.toLowerCase().replace(/^@/, '')
    condiciones.push(`emails.cs.{"${valor}"}`)
    condiciones.push(`email_domains.cs.{"${valor}"}`)
  }
  return condiciones.join(',')
}

export async function listarClientes(
  companyId: string,
  filtros: FiltrosClientes,
): Promise<PaginaDeClientes> {
  let q = supabase
    .from('customers')
    .select(COLUMNAS_LISTADO, { count: 'exact' })
    .eq('company_id', companyId)

  const busqueda = condicionDeBusqueda(filtros.q)
  if (busqueda) q = q.or(busqueda)
  if (filtros.rubro) q = q.eq('industry', filtros.rubro)
  if (filtros.soloRevision) q = q.eq('needs_review', true)
  // Un cliente dado de baja sigue existiendo —sus documentos lo necesitan—
  // pero no aparece salvo que se pida.
  if (!filtros.incluirBajas) q = q.is('deleted_at', null)

  const columna = {
    nombre: 'legal_name',
    referencia: 'legacy_ref',
    cuit: 'tax_id',
    rubro: 'industry',
  }[filtros.orden]
  const asc = filtros.direccion === 'asc'
  q = q.order(columna, { ascending: asc, nullsFirst: false })
  // Desempate estable: sin esto dos clientes sin rubro pueden cambiar de
  // orden entre páginas y una fila sale dos veces o ninguna.
  if (columna !== 'legal_name') q = q.order('legal_name', { ascending: true })
  q = q.order('id', { ascending: true })

  const desde = (filtros.pagina - 1) * filtros.porPagina
  q = q.range(desde, desde + filtros.porPagina - 1)

  const { data, error, count } = await q
  if (error) throw new Error(`No se pudo leer el listado de clientes: ${error.message}`)

  return {
    filas: ((data ?? []) as unknown as FilaListado[]).map(aFila),
    total: count ?? 0,
  }
}

/**
 * Exporta lo que muestran los filtros, pidiendo páginas al servidor.
 *
 * No se baja la tabla entera para filtrar en el navegador; se piden las
 * mismas filas que se están viendo, de a mil.
 */
export async function exportarClientes(
  companyId: string,
  filtros: FiltrosClientes,
): Promise<{ filas: ClienteListado[]; total: number }> {
  const TAMANO = 1000
  // Tope de cortesía: exportar 1.010 clientes son dos requests; nadie exporta
  // cinco mil y si alguna vez pasa, es mejor que corte a que el navegador se
  // quede sin memoria en silencio.
  const TOPE = 5000
  const primera = await listarClientes(companyId, { ...filtros, pagina: 1, porPagina: TAMANO })
  const filas = [...primera.filas]
  const total = primera.total
  for (let pagina = 2; filas.length < total && filas.length < TOPE; pagina += 1) {
    const p = await listarClientes(companyId, { ...filtros, pagina, porPagina: TAMANO })
    // Una página vacía corta el bucle: sin esto, un `total` que no coincide
    // con lo que devuelve el servidor lo dejaría girando para siempre.
    if (p.filas.length === 0) break
    filas.push(...p.filas)
  }
  return { filas, total }
}

/** Los rubros realmente en uso, para el filtro. Hoy hay uno solo. */
export async function rubrosUsados(companyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('industry')
    .eq('company_id', companyId)
    .not('industry', 'is', null)
    // El rubro de un cliente dado de baja no tiene por qué seguir ofreciéndose
    // como opción del filtro.
    .is('deleted_at', null)
    .limit(1000)
  if (error) throw new Error(`No se pudieron leer los rubros: ${error.message}`)
  const vistos = new Set<string>()
  for (const f of (data ?? []) as unknown as { industry: string | null }[]) {
    const r = (f.industry ?? '').trim()
    if (r !== '') vistos.add(r)
  }
  return [...vistos].sort((a, b) => a.localeCompare(b, 'es'))
}

// ── Ficha ──────────────────────────────────────────────────────────────────

const COLUMNAS_DETALLE = `
  id, legacy_ref, legal_name, trade_name, legacy_name, tax_id, emails,
  email_domains, industry, phone, customer_type, status, payment_terms,
  default_currency, discount_pct, credit_limit, notes, imported_at,
  legacy_source, needs_review, review_reason, deleted_at, created_at,
  updated_at, salesperson_id, default_price_list_id,
  vendedor:profiles!salesperson_id ( full_name ),
  tarifa:price_lists!default_price_list_id ( name )
`

interface FilaDetalle extends FilaListado {
  legacy_name: string | null
  customer_type: string
  status: string
  payment_terms: string | null
  default_currency: string | null
  discount_pct: number | string
  credit_limit: number | string | null
  notes: string | null
  legacy_source: string | null
  created_at: string
  updated_at: string
  salesperson_id: string | null
  default_price_list_id: string | null
  vendedor: { full_name: string | null } | null
  tarifa: { name: string | null } | null
}

function aNumero(v: number | string | null): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export async function obtenerCliente(
  companyId: string,
  id: string,
): Promise<ClienteDetalle | null> {
  const { data, error } = await supabase
    .from('customers')
    .select(COLUMNAS_DETALLE)
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el cliente: ${error.message}`)
  if (!data) return null

  const f = data as unknown as FilaDetalle
  return {
    id: f.id,
    referencia: f.legacy_ref,
    razonSocial: f.legal_name,
    nombreComercial: f.trade_name,
    nombreLegacy: f.legacy_name,
    cuit: f.tax_id,
    emails: f.emails ?? [],
    dominios: f.email_domains ?? [],
    rubro: f.industry,
    telefono: f.phone,
    tipo: f.customer_type,
    estado: f.status,
    condicionDePago: f.payment_terms,
    monedaPorDefecto: f.default_currency,
    descuentoPct: aNumero(f.discount_pct) ?? 0,
    limiteDeCredito: aNumero(f.credit_limit),
    vendedor: f.vendedor?.full_name ?? null,
    vendedorId: f.salesperson_id,
    tarifaId: f.default_price_list_id,
    tarifaNombre: f.tarifa?.name ?? null,
    notas: f.notes,
    esHistorico: f.imported_at !== null,
    origenLegacy: f.legacy_source,
    necesitaRevision: f.needs_review,
    motivosRevision: separarMotivos(f.review_reason),
    dadoDeBaja: f.deleted_at !== null,
    creadoEn: f.created_at,
    actualizadoEn: f.updated_at,
  }
}

export async function contactosDeCliente(
  companyId: string,
  clienteId: string,
): Promise<ContactoCliente[]> {
  const { data, error } = await supabase
    .from('customer_contacts')
    .select('id, full_name, role, email, phone, fax, is_default, notes, active, updated_at')
    .eq('company_id', companyId)
    .eq('customer_id', clienteId)
    // Los activos primero, y entre ellos el principal: es el orden en el que
    // alguien los busca. Los desactivados quedan al final, visibles.
    .order('active', { ascending: false })
    .order('is_default', { ascending: false })
    .order('full_name', { ascending: true })
  if (error) throw new Error(`No se pudieron leer los contactos: ${error.message}`)

  return (data ?? []).map((c) => ({
    id: c.id,
    nombre: c.full_name,
    cargo: c.role?.trim() || null,
    email: c.email?.trim() || null,
    telefono: c.phone?.trim() || null,
    fax: c.fax?.trim() || null,
    esPrincipal: c.is_default,
    notas: c.notes,
    activo: c.active,
    actualizadoEn: c.updated_at,
  }))
}

/**
 * El historial documental del cliente, paginado (Fase 17 · E4).
 *
 * Antes eran TRES consultas desde el navegador con `limit 200` cada una,
 * unidas y ordenadas en memoria: los 258 documentos de Grupo Mirgor viajaban
 * al abrir la ficha aunque nadie mirara la pestaña. Ahora es **una** consulta
 * —`documentos_del_cliente`, un UNION del lado del servidor— que devuelve la
 * página pedida y, en la misma pasada, cuántos hay en total.
 */
export async function documentosDeCliente(
  clienteId: string,
  opciones: { tipo?: string | null; pagina?: number; porPagina?: number } = {},
): Promise<PaginaDeDocumentos> {
  const porPagina = opciones.porPagina ?? 25
  const pagina = opciones.pagina ?? 1

  const { data, error } = await supabase.rpc('documentos_del_cliente', {
    p_customer: clienteId,
    p_tipo: opciones.tipo ?? null,
    p_limit: porPagina,
    p_offset: (pagina - 1) * porPagina,
  })
  if (error) throw new Error(`No se pudo leer el historial: ${error.message}`)

  const filas = (data ?? []) as unknown as {
    tipo: string
    documento_id: string
    numero: string | null
    fecha: string | null
    estado: string | null
    moneda: string | null
    total: number | string | null
    total_filas: number | string
  }[]

  return {
    filas: filas.map((f) => ({
      id: f.documento_id,
      tipo: f.tipo as DocumentoDeCliente['tipo'],
      // En el histórico se muestra el número original literal, que es el que
      // figura en el papel que tiene el cliente.
      numero: f.numero ?? '',
      fecha: f.fecha ?? '',
      estado: f.estado ?? '',
      moneda: f.moneda,
      total: aNumero(f.total),
    })),
    total: filas.length > 0 ? (Number(filas[0]!.total_filas) || 0) : 0,
  }
}

/**
 * Las direcciones del cliente (Fase 17 · E4: consulta propia).
 *
 * Venía junto con los candidatos de orden de compra en `relacionadosDeCliente`.
 * Se separó porque la ficha necesita la dirección principal **siempre** —va en
 * la cabecera— y los candidatos de OC casi nunca: son 134 filas repartidas en
 * 19 de los 1.010 clientes. Pedirlos juntos era pagar los dos por uno.
 */
export async function direccionesDeCliente(
  companyId: string,
  clienteId: string,
): Promise<DireccionCliente[]> {
  const { data, error } = await supabase
    .from('customer_addresses')
    .select(
      'id, kind, is_default, street, city, state, postal_code, country_code, notes, active, updated_at',
    )
    .eq('company_id', companyId)
    .eq('customer_id', clienteId)
    .order('active', { ascending: false })
    .order('is_default', { ascending: false })
    .order('kind', { ascending: true })
  if (error) throw new Error(`No se pudieron leer las direcciones: ${error.message}`)

  return (data ?? []).map((d) => ({
    id: d.id,
    tipo: d.kind,
    calle: d.street ?? '',
    ciudad: d.city,
    provincia: d.state,
    codigoPostal: d.postal_code,
    pais: d.country_code,
    notas: d.notes,
    esPrincipal: d.is_default,
    texto: [d.street, d.city, d.state, d.postal_code, d.country_code]
      .map((p) => (p ?? '').trim())
      .filter((p) => p !== '')
      .join(', '),
    activo: d.active,
    actualizadoEn: d.updated_at,
  }))
}

/**
 * Los candidatos de orden de compra que detectó la migración leyendo los
 * documentos. Ninguna OC se crea sola a partir de ellos.
 */
export async function candidatosDeOc(
  companyId: string,
  clienteId: string,
): Promise<CandidatoDeOc[]> {
  const { data, error } = await supabase
    .from('customer_po_candidates')
    .select('id, candidate, source_type, doc_count, status, created_at')
    .eq('company_id', companyId)
    .eq('customer_id', clienteId)
    .order('doc_count', { ascending: false })
    .limit(50)
  if (error) throw new Error(`No se pudieron leer las OC: ${error.message}`)

  return (data ?? []).map((c) => ({
    id: c.id,
    archivo: c.candidate,
    detectadoEn: c.created_at,
    estado: c.status,
  }))
}

// ── Opciones comerciales (Fase 17 · E1) ────────────────────────────────────

export interface OpcionCliente {
  id: string
  nombre: string
}

/**
 * A quién se le puede asignar un cliente.
 *
 * Los roles internos que venden, activos, de ESTA empresa: es exactamente el
 * conjunto que acepta `guardar_cliente`, que rechaza cualquier otro con
 * `VENDEDOR_INVALIDO`. Ofrecer más sería ofrecer un error.
 */
export async function vendedoresDeEmpresa(companyId: string): Promise<OpcionCliente[]> {
  const { data, error } = await supabase
    .from('company_memberships')
    .select('user_id, profiles!user_id ( full_name )')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .in('role', ['admin', 'employee', 'salesperson'])
  if (error) throw new Error(`No se pudieron leer los vendedores: ${error.message}`)

  return ((data ?? []) as unknown as { user_id: string; profiles: { full_name: string | null } | null }[])
    .map((m) => ({ id: m.user_id, nombre: m.profiles?.full_name ?? 'Sin nombre' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/**
 * Las listas de precios de la empresa. Son cuatro; no hace falta paginar.
 *
 * Se muestra la moneda junto al nombre: una tarifa en dólares sobre un cliente
 * que factura en pesos no va a servir para sugerir nada, y conviene verlo al
 * elegirla y no al crear el documento.
 */
export async function tarifasDeEmpresa(companyId: string): Promise<OpcionCliente[]> {
  const { data, error } = await supabase
    .from('price_lists')
    .select('id, name, currency_code')
    .eq('company_id', companyId)
    .order('is_default', { ascending: false })
    .order('name')
  if (error) throw new Error(`No se pudieron leer las tarifas: ${error.message}`)
  return (data ?? []).map((p) => ({
    id: p.id,
    nombre: p.currency_code ? `${p.name} · ${p.currency_code}` : p.name,
  }))
}
