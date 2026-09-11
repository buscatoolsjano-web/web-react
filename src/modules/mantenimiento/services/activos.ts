import { supabase } from '@/services/supabase/client'
import type {
  ActivoDetalle,
  ActivoListado,
  DuplicadoDeSerial,
  FiltrosActivos,
  PaginaDeActivos,
} from '../types'

/**
 * Equipos de mantenimiento.
 *
 * Tres reglas que vienen del schema y no de esta pantalla:
 *
 *   1. **La identidad es el uuid**, no el serial. El serial es un atributo
 *      importante pero puede faltar y puede estar mal cargado.
 *   2. **El serial no es único**: la base no lo bloquea porque el legacy
 *      nunca lo garantizó. Se avisa con `duplicados_de_serial()`.
 *   3. **`owner_customer_id` es el dueño ACTUAL** y puede cambiar. Las
 *      órdenes guardan su propio cliente congelado, así que cambiarlo no
 *      reescribe una sola orden vieja.
 */

const vacioANulo = (s: string): string | null => {
  const t = s.trim()
  return t === '' ? null : t
}

const COLUMNAS = `
  id, reference, identifier, serial_number, serial_normalized, owner_customer_id,
  product_id, asset_type, brand_text, model_text, city, under_contract,
  deleted_at, created_at,
  dueno:customers!owner_customer_id ( legal_name ),
  producto:products!product_id ( sku ),
  maintenance_orders ( id )
`

interface Fila {
  id: string
  reference: string
  identifier: string | null
  serial_number: string | null
  serial_normalized: string | null
  owner_customer_id: string | null
  product_id: string | null
  asset_type: string | null
  brand_text: string | null
  model_text: string | null
  city: string | null
  under_contract: boolean
  deleted_at: string | null
  created_at: string
  dueno: { legal_name: string } | null
  producto: { sku: string } | null
  maintenance_orders: { id: string }[] | null
}

const aFila = (f: Fila): ActivoListado => ({
  id: f.id,
  referencia: f.reference,
  identificador: f.identifier,
  serie: f.serial_number,
  serieNormalizada: f.serial_normalized,
  duenoId: f.owner_customer_id,
  dueno: f.dueno?.legal_name ?? null,
  productoId: f.product_id,
  productoSku: f.producto?.sku ?? null,
  marca: f.brand_text,
  modelo: f.model_text,
  tipo: f.asset_type,
  ciudad: f.city,
  bajoContrato: f.under_contract,
  dadoDeBaja: f.deleted_at !== null,
  ordenes: (f.maintenance_orders ?? []).length,
  creadoEn: f.created_at,
})

export async function listarActivos(
  companyId: string,
  filtros: FiltrosActivos,
): Promise<PaginaDeActivos> {
  let q = supabase
    .from('maintenance_assets')
    .select(COLUMNAS, { count: 'exact' })
    .eq('company_id', companyId)

  // La coma y los paréntesis rompen la sintaxis de PostgREST.
  const texto = filtros.q.trim().replace(/[,()*]/g, '')
  if (texto !== '') {
    // Se busca por las tres cosas con las que alguien identifica una
    // herramienta en el mostrador: la referencia, el serial y la etiqueta.
    q = q.or(
      `reference.ilike.%${texto}%,serial_number.ilike.%${texto}%,identifier.ilike.%${texto}%`,
    )
  }
  if (filtros.clienteId) q = q.eq('owner_customer_id', filtros.clienteId)
  if (filtros.productoId) q = q.eq('product_id', filtros.productoId)
  if (filtros.tipo) q = q.eq('asset_type', filtros.tipo)
  if (filtros.estado === 'activo') q = q.is('deleted_at', null)
  if (filtros.estado === 'baja') q = q.not('deleted_at', 'is', null)

  const columna = {
    referencia: 'reference',
    serie: 'serial_number',
    cliente: 'owner_customer_id',
    modelo: 'model_text',
    alta: 'created_at',
  }[filtros.orden]
  const asc = filtros.direccion === 'asc'
  q = q.order(columna, { ascending: asc, nullsFirst: false })
  // Desempate estable: sin esto una fila puede salir dos veces entre páginas.
  if (columna !== 'reference') q = q.order('reference', { ascending: asc })

  const desde = (filtros.pagina - 1) * filtros.porPagina
  q = q.range(desde, desde + filtros.porPagina - 1)

  const { data, error, count } = await q
  if (error) throw new Error(`No se pudo leer el listado de equipos: ${error.message}`)

  return { filas: ((data ?? []) as unknown as Fila[]).map(aFila), total: count ?? 0 }
}

export async function obtenerActivo(
  companyId: string,
  id: string,
): Promise<ActivoDetalle | null> {
  const { data, error } = await supabase
    .from('maintenance_assets')
    .select(
      `${COLUMNAS}, state, warranty_start, warranty_end, notes, delivery_serial_id, updated_at,
       autor:profiles!created_by ( full_name ),
       procedencia:delivery_serials!delivery_serial_id (
         serial_number, delivery_date,
         linea:delivery_lines!delivery_line_id (
           entrega:deliveries!delivery_id ( number )
         )
       )`,
    )
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el equipo: ${error.message}`)
  if (!data) return null

  const f = data as unknown as Fila & {
    state: string | null
    warranty_start: string | null
    warranty_end: string | null
    notes: string | null
    delivery_serial_id: string | null
    updated_at: string
    autor: { full_name: string | null } | null
    procedencia: {
      serial_number: string
      delivery_date: string
      linea: { entrega: { number: string } | null } | null
    } | null
  }

  return {
    ...aFila(f),
    provincia: f.state,
    garantiaDesde: f.warranty_start,
    garantiaHasta: f.warranty_end,
    notas: f.notes,
    entregaSerialId: f.delivery_serial_id,
    procedencia: f.procedencia
      ? {
          serial: f.procedencia.serial_number,
          fecha: f.procedencia.delivery_date,
          entregaNumero: f.procedencia.linea?.entrega?.number ?? null,
        }
      : null,
    autor: f.autor?.full_name ?? null,
    actualizadoEn: f.updated_at,
  }
}

/**
 * Los otros equipos con el mismo serial.
 *
 * **Avisa, no bloquea.** El legacy nunca garantizó el serial —no es
 * obligatorio ni único— así que rechazar un alta por una regla que no existía
 * sería inventarla. Se registra la ambigüedad, como `needs_review` en
 * proveedores.
 */
export async function duplicadosDeSerial(
  companyId: string,
  serial: string,
  excluir: string | null = null,
): Promise<DuplicadoDeSerial[]> {
  if (serial.trim() === '') return []
  const { data, error } = await supabase.rpc('duplicados_de_serial', {
    p_company: companyId,
    p_serial: serial,
    p_excluir: excluir,
  })
  if (error) throw new Error(`No se pudieron buscar duplicados: ${error.message}`)

  return ((data ?? []) as unknown as {
    id: string
    reference: string
    model_text: string | null
    serial_number: string | null
    owner_customer_id: string | null
    created_at: string
  }[]).map((d) => ({
    id: d.id,
    referencia: d.reference,
    modelo: d.model_text,
    serie: d.serial_number,
    duenoId: d.owner_customer_id,
    creadoEn: d.created_at,
  }))
}

/** Los tipos de equipo que realmente se usaron, para el filtro. Sin inventar. */
export async function tiposUsados(companyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('maintenance_assets')
    .select('asset_type')
    .eq('company_id', companyId)
    .not('asset_type', 'is', null)
    .limit(2000)
  if (error) throw new Error(`No se pudieron leer los tipos: ${error.message}`)
  const vistos = new Set<string>()
  for (const f of (data ?? []) as unknown as { asset_type: string | null }[]) {
    const t = (f.asset_type ?? '').trim()
    if (t !== '') vistos.add(t)
  }
  return [...vistos].sort()
}

// ── Escritura ──────────────────────────────────────────────────────────────

export interface DatosActivo {
  duenoId: string | null
  productoId: string | null
  identificador: string
  serie: string
  marca: string
  modelo: string
  tipo: string
  ciudad: string
  provincia: string
  garantiaDesde: string
  garantiaHasta: string
  bajoContrato: boolean
  notas: string
}

function fila(d: DatosActivo) {
  return {
    owner_customer_id: d.duenoId,
    product_id: d.productoId,
    identifier: vacioANulo(d.identificador),
    serial_number: vacioANulo(d.serie),
    brand_text: vacioANulo(d.marca),
    model_text: vacioANulo(d.modelo),
    asset_type: vacioANulo(d.tipo),
    city: vacioANulo(d.ciudad),
    state: vacioANulo(d.provincia),
    warranty_start: vacioANulo(d.garantiaDesde),
    warranty_end: vacioANulo(d.garantiaHasta),
    under_contract: d.bajoContrato,
    notes: vacioANulo(d.notas),
  }
}

async function proximaReferencia(companyId: string): Promise<string> {
  const { data, error } = await supabase.rpc('next_document_number', {
    p_company: companyId,
    p_doc_type: 'maintenance_asset',
  })
  if (error) throw new Error(`No se pudo obtener la referencia: ${traducir(error.message, error.code)}`)
  if (!data) throw new Error('La numeración no devolvió ninguna referencia')
  return data
}

export async function crearActivo(
  companyId: string,
  d: DatosActivo,
): Promise<{ id: string; referencia: string }> {
  const referencia = await proximaReferencia(companyId)
  const { data, error } = await supabase
    .from('maintenance_assets')
    .insert({ company_id: companyId, reference: referencia, ...fila(d) })
    .select('id, reference')
    .single()
  if (error) throw new Error(traducir(error.message, error.code))
  return { id: data.id, referencia: data.reference }
}

export async function actualizarActivo(
  companyId: string,
  id: string,
  d: DatosActivo,
): Promise<void> {
  const { error } = await supabase
    .from('maintenance_assets')
    .update(fila(d))
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

/**
 * Baja lógica.
 *
 * Un equipo con historial no se borra: sus órdenes lo referencian y borrarlo
 * dejaría documentos huérfanos. Se marca con fecha, como los clientes.
 */
export async function darDeBajaActivo(companyId: string, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('maintenance_assets')
    .update({ deleted_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
  if (error) throw new Error(traducir(error.message, error.code))
  return (data ?? []).length > 0
}

export async function reactivarActivo(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('maintenance_assets')
    .update({ deleted_at: null, deleted_by: null })
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

/** El error de Postgres, en castellano. */
/**
 * Los CHECK de tabla que puede tocar esta pantalla, en castellano.
 *
 * Un trigger levanta su excepción con un mensaje escrito para leer; un CHECK
 * de tabla devuelve «violates check constraint "chk_..."», que no le dice nada
 * a quien está cargando datos. Se traduce por nombre de constraint.
 */
const CONSTRAINTS: Record<string, string> = {
  chk_ma_garantia: 'La garantía no puede terminar antes de empezar.',
}

function traducir(mensaje: string, codigo?: string): string {
  for (const [nombre, texto] of Object.entries(CONSTRAINTS)) {
    if (mensaje.includes(nombre)) return texto
  }
  if (codigo === '23001' || codigo === '23514') return mensaje
  if (codigo === '23505' && mensaje.includes('reference')) {
    return 'Esa referencia de equipo ya existe.'
  }
  if (codigo === '42501') {
    return 'No tenés permiso para hacer este cambio. Mantenimiento es de administradores y empleados.'
  }
  return mensaje
}

export interface ActivoBuscado {
  id: string
  referencia: string
  serie: string | null
  modelo: string | null
  duenoId: string | null
  dueno: string | null
}

/**
 * Búsqueda de equipos para elegir uno, contra el servidor.
 *
 * Devuelve el dueño actual junto con el equipo porque es el dato que la orden
 * necesita inmediatamente después: el cliente de la orden se precarga de acá y
 * después queda congelado.
 *
 * Los dados de baja no aparecen: un equipo de baja no entra al taller.
 */
export async function buscarActivos(
  companyId: string,
  texto: string,
  tope = 20,
): Promise<ActivoBuscado[]> {
  const t = texto.trim().replace(/[,()*]/g, '')
  if (t.length < 2) return []

  const { data, error } = await supabase
    .from('maintenance_assets')
    .select('id, reference, serial_number, model_text, owner_customer_id, dueno:customers!owner_customer_id ( legal_name )')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .or(`reference.ilike.%${t}%,serial_number.ilike.%${t}%,identifier.ilike.%${t}%`)
    .order('reference')
    .limit(tope)
  if (error) throw new Error(`No se pudieron buscar equipos: ${error.message}`)

  return ((data ?? []) as unknown as {
    id: string
    reference: string
    serial_number: string | null
    model_text: string | null
    owner_customer_id: string | null
    dueno: { legal_name: string } | null
  }[]).map((a) => ({
    id: a.id,
    referencia: a.reference,
    serie: a.serial_number,
    modelo: a.model_text,
    duenoId: a.owner_customer_id,
    dueno: a.dueno?.legal_name ?? null,
  }))
}

/**
 * Todo lo que muestran los filtros, para el CSV.
 *
 * Va pidiendo páginas al servidor en vez de una consulta sin `range`: así el
 * filtro es exactamente el del listado —una sola definición, no dos que
 * pueden divergir— y ninguna respuesta llega con miles de filas de una.
 */
export async function exportarActivos(
  companyId: string,
  filtros: FiltrosActivos,
): Promise<{ filas: ActivoListado[]; total: number }> {
  const TAMANO = 1000
  const TOPE = 5000
  const primera = await listarActivos(companyId, { ...filtros, pagina: 1, porPagina: TAMANO })
  const filas = [...primera.filas]
  const total = primera.total
  for (let pagina = 2; filas.length < total && filas.length < TOPE; pagina += 1) {
    const p = await listarActivos(companyId, { ...filtros, pagina, porPagina: TAMANO })
    // Una página vacía corta el bucle: sin esto, un `total` que no coincide con
    // lo que devuelve el servidor lo dejaría girando para siempre.
    if (p.filas.length === 0) break
    filas.push(...p.filas)
  }
  return { filas, total }
}
