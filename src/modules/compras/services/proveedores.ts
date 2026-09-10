import { supabase } from '@/services/supabase/client'
import { separarMotivos } from '../lib/motivos'
import type {
  ComprasDelProveedor,
  EventoDeProveedor,
  FiltrosProveedores,
  PaginaDeProveedores,
  ProveedorDetalle,
  ProveedorListado,
} from '../types'

/**
 * Lectura del maestro de proveedores.
 *
 * Todo del lado del servidor: filtros, orden, página y el total exacto. Son
 * 142 filas y cabrían en memoria, pero el listado de Clientes ya demostró que
 * «cabe» deja de ser cierto sin avisar.
 *
 * Lo que se puede leer lo decide RLS. Compras es admin y employee: a
 * cualquier otro rol este listado le vuelve vacío, sin error.
 */

/** Columnas del listado. Nunca `select('*')`. */
const COLUMNAS_LISTADO = `
  id, legacy_ref, legal_name, trade_name, country_code, phone, email,
  payment_terms, status, imported_at, needs_review, review_reason, deleted_at
`

interface FilaListado {
  id: string
  legacy_ref: string | null
  legal_name: string
  trade_name: string | null
  country_code: string | null
  phone: string | null
  email: string | null
  payment_terms: string | null
  status: string
  imported_at: string | null
  needs_review: boolean
  review_reason: string | null
  deleted_at: string | null
}

function aFila(f: FilaListado): ProveedorListado {
  return {
    id: f.id,
    referencia: f.legacy_ref,
    razonSocial: f.legal_name,
    nombreComercial: f.trade_name,
    pais: f.country_code,
    telefono: f.phone,
    email: f.email,
    formaPago: f.payment_terms,
    estado: f.status,
    esHistorico: f.imported_at !== null,
    necesitaRevision: f.needs_review,
    motivosRevision: separarMotivos(f.review_reason),
    dadoDeBaja: f.deleted_at !== null,
  }
}

/**
 * Búsqueda libre.
 *
 * Razón social, nombre comercial, referencia y email. No busca dentro de las
 * notas: son fichas de contacto de varias líneas y buscar ahí devolvería
 * coincidencias que la persona no puede ver desde el listado.
 *
 * La coma y los paréntesis se sacan del patrón: PostgREST usa la coma para
 * separar las condiciones de un `or` y el texto se le mete adentro.
 */
function condicionDeBusqueda(texto: string): string | null {
  const limpio = texto.trim().replace(/[,()*]/g, '')
  if (limpio === '') return null
  const patron = `%${limpio}%`
  return [
    `legal_name.ilike.${patron}`,
    `trade_name.ilike.${patron}`,
    `legacy_ref.ilike.${patron}`,
    `email.ilike.${patron}`,
  ].join(',')
}

export async function listarProveedores(
  companyId: string,
  filtros: FiltrosProveedores,
): Promise<PaginaDeProveedores> {
  let q = supabase
    .from('suppliers')
    .select(COLUMNAS_LISTADO, { count: 'exact' })
    .eq('company_id', companyId)

  const busqueda = condicionDeBusqueda(filtros.q)
  if (busqueda) q = q.or(busqueda)
  if (filtros.estado) q = q.eq('status', filtros.estado)
  if (filtros.soloRevision) q = q.eq('needs_review', true)
  // Un proveedor dado de baja sigue existiendo —sus documentos lo necesitan—
  // pero no aparece salvo que se pida.
  if (!filtros.incluirBajas) q = q.is('deleted_at', null)

  const columna = {
    nombre: 'legal_name',
    referencia: 'legacy_ref',
    pais: 'country_code',
    formaPago: 'payment_terms',
  }[filtros.orden]
  q = q.order(columna, { ascending: filtros.direccion === 'asc', nullsFirst: false })
  // Desempate estable: sin esto dos proveedores del mismo país pueden cambiar
  // de orden entre páginas y una fila sale dos veces o ninguna.
  if (columna !== 'legal_name') q = q.order('legal_name', { ascending: true })
  q = q.order('id', { ascending: true })

  const desde = (filtros.pagina - 1) * filtros.porPagina
  q = q.range(desde, desde + filtros.porPagina - 1)

  const { data, error, count } = await q
  if (error) throw new Error(`No se pudo leer el listado de proveedores: ${error.message}`)

  return {
    filas: ((data ?? []) as unknown as FilaListado[]).map(aFila),
    total: count ?? 0,
  }
}

/** Exporta lo que muestran los filtros, pidiendo páginas al servidor. */
export async function exportarProveedores(
  companyId: string,
  filtros: FiltrosProveedores,
): Promise<{ filas: ProveedorListado[]; total: number }> {
  const TAMANO = 1000
  const TOPE = 5000
  const primera = await listarProveedores(companyId, { ...filtros, pagina: 1, porPagina: TAMANO })
  const filas = [...primera.filas]
  const total = primera.total
  for (let pagina = 2; filas.length < total && filas.length < TOPE; pagina += 1) {
    const p = await listarProveedores(companyId, { ...filtros, pagina, porPagina: TAMANO })
    // Una página vacía corta el bucle: sin esto, un `total` que no coincide
    // con lo que devuelve el servidor lo dejaría girando para siempre.
    if (p.filas.length === 0) break
    filas.push(...p.filas)
  }
  return { filas, total }
}

/** Los países realmente en uso, para mostrarlos en la ficha sin inventar. */
export async function paisesUsados(companyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('suppliers')
    .select('country_code')
    .eq('company_id', companyId)
    .not('country_code', 'is', null)
    .is('deleted_at', null)
    .limit(2000)
  if (error) throw new Error(`No se pudieron leer los países: ${error.message}`)
  const vistos = new Set<string>()
  for (const f of (data ?? []) as unknown as { country_code: string | null }[]) {
    const c = (f.country_code ?? '').trim()
    if (c !== '') vistos.add(c)
  }
  return [...vistos].sort()
}

/** Las formas de pago que ya existen, para sugerirlas sin cerrarlas. */
export async function formasDePagoUsadas(companyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('suppliers')
    .select('payment_terms')
    .eq('company_id', companyId)
    .not('payment_terms', 'is', null)
    .is('deleted_at', null)
    .limit(2000)
  if (error) throw new Error(`No se pudieron leer las formas de pago: ${error.message}`)
  const vistos = new Set<string>()
  for (const f of (data ?? []) as unknown as { payment_terms: string | null }[]) {
    const t = (f.payment_terms ?? '').trim()
    if (t !== '') vistos.add(t)
  }
  return [...vistos].sort((a, b) => a.localeCompare(b, 'es'))
}

// ── Ficha ──────────────────────────────────────────────────────────────────

const COLUMNAS_DETALLE = `
  id, legacy_ref, legal_name, trade_name, tax_id, email, phone, address_text,
  country_code, activity, agent, payment_terms, default_currency, notes,
  status, imported_at, legacy_source, needs_review, review_reason, deleted_at,
  created_at
`

interface FilaDetalle extends FilaListado {
  tax_id: string | null
  address_text: string | null
  activity: string | null
  agent: string | null
  default_currency: string | null
  notes: string | null
  legacy_source: string | null
  created_at: string
}

export async function obtenerProveedor(
  companyId: string,
  id: string,
): Promise<ProveedorDetalle | null> {
  const { data, error } = await supabase
    .from('suppliers')
    .select(COLUMNAS_DETALLE)
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el proveedor: ${error.message}`)
  if (!data) return null

  const f: FilaDetalle = data
  return {
    id: f.id,
    referencia: f.legacy_ref,
    razonSocial: f.legal_name,
    nombreComercial: f.trade_name,
    cuit: f.tax_id,
    email: f.email,
    telefono: f.phone,
    direccion: f.address_text,
    pais: f.country_code,
    actividad: f.activity,
    agente: f.agent,
    formaPago: f.payment_terms,
    monedaPorDefecto: f.default_currency,
    notas: f.notes,
    estado: f.status,
    esHistorico: f.imported_at !== null,
    origenLegacy: f.legacy_source,
    necesitaRevision: f.needs_review,
    motivosRevision: separarMotivos(f.review_reason),
    dadoDeBaja: f.deleted_at !== null,
    creadoEn: f.created_at,
  }
}

/**
 * Qué hay de este proveedor en el circuito de compras.
 *
 * Hoy la respuesta es cero en los tres, y eso es un dato real: la entrega 1
 * creó el schema y todavía no se cargó ningún documento. Se cuenta contra las
 * tablas de verdad —no se devuelve un cero escrito a mano— para que el día
 * que haya pedidos, la ficha los muestre sin tocar nada.
 */
export async function comprasDelProveedor(
  companyId: string,
  proveedorId: string,
): Promise<ComprasDelProveedor> {
  const contar = async (tabla: 'purchase_orders' | 'goods_receipts' | 'supplier_invoices') => {
    const { count, error } = await supabase
      .from(tabla)
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('supplier_id', proveedorId)
    if (error) throw new Error(`No se pudo contar ${tabla}: ${error.message}`)
    return count ?? 0
  }
  const [pedidos, recepciones, facturas] = await Promise.all([
    contar('purchase_orders'),
    contar('goods_receipts'),
    contar('supplier_invoices'),
  ])
  return { pedidos, recepciones, facturas }
}

/**
 * El historial del proveedor: `purchases_audit`.
 *
 * La tabla es de sólo lectura desde PostgREST —su única policy es SELECT— y
 * se escribe por `registrar_evento_compra`. Los 142 migrados no tienen
 * eventos: el script de migración no auditó fila por fila, y decir que sí lo
 * hizo sería falsificar el historial.
 */
export async function historialDeProveedor(
  companyId: string,
  proveedorId: string,
  tope = 100,
): Promise<EventoDeProveedor[]> {
  const { data, error } = await supabase
    .from('purchases_audit')
    .select('id, action, from_status, to_status, diff, created_at, actor:profiles!actor_id ( full_name )')
    .eq('company_id', companyId)
    .eq('entity_type', 'supplier')
    .eq('entity_id', proveedorId)
    .order('created_at', { ascending: false })
    .limit(tope)
  if (error) throw new Error(`No se pudo leer el historial: ${error.message}`)

  return ((data ?? []) as unknown as {
    id: number
    action: string
    from_status: string | null
    to_status: string | null
    diff: Record<string, unknown> | null
    created_at: string
    actor: { full_name: string | null } | null
  }[]).map((e) => ({
    id: e.id,
    accion: e.action,
    estadoAnterior: e.from_status,
    estadoNuevo: e.to_status,
    autor: e.actor?.full_name ?? null,
    fecha: e.created_at,
    diff: e.diff,
  }))
}
