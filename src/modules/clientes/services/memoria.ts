import { supabase } from '@/services/supabase/client'
import { claveDe, type DatosAlias } from '../lib/alias'
import type { AliasDeProducto, ProductoBuscado } from '../types'

/**
 * Memoria de productos: cómo llama cada cliente a cada SKU.
 *
 * En el legacy vivía en `localStorage` bajo `spd_client_memory_v1`, con esta
 * forma:
 *
 *     { "mabe argentina s.a.": { "sp.vptx20/50 x 5": "SP.VPTX20/50" } }
 *
 * La clave era el **nombre normalizado del cliente**. Renombrarlo perdía su
 * memoria entera, y dos clientes con el mismo nombre normalizado la
 * compartían. Acá la relación es `customer_id`, y la unicidad es
 * `(company_id, customer_id, normalized_key)`: **el mismo código puede
 * significar productos distintos en clientes distintos**, que es justamente lo
 * que pasa —«tubo largo mm 38» no quiere decir lo mismo en todas partes—.
 */

interface FilaAlias {
  id: string
  customer_code: string | null
  customer_description: string | null
  normalized_key: string
  status: string
  source: string | null
  confidence: number | string | null
  times_used: number
  confirmed_by: string | null
  created_at: string
  updated_at: string
  product_id: string
  product: { sku: string | null; name: string | null; marca: { name: string } | null } | null
}

function aAlias(f: FilaAlias): AliasDeProducto {
  return {
    id: f.id,
    codigoCliente: f.customer_code,
    descripcionCliente: f.customer_description,
    clave: f.normalized_key,
    productId: f.product_id,
    sku: f.product?.sku ?? null,
    nombreProducto: f.product?.name ?? null,
    marca: f.product?.marca?.name ?? null,
    estado: f.status,
    origen: f.source,
    vecesUsado: f.times_used,
    confirmadoPorPersona: f.confirmed_by !== null,
    creadoEn: f.created_at,
    actualizadoEn: f.updated_at,
  }
}

const COLUMNAS = `
  id, customer_code, customer_description, normalized_key, status, source,
  confidence, times_used, confirmed_by, created_at, updated_at, product_id,
  product:products!product_id ( sku, name, marca:brands!brand_id ( name ) )
`

export async function listarAlias(
  companyId: string,
  clienteId: string,
): Promise<AliasDeProducto[]> {
  const { data, error } = await supabase
    .from('customer_product_aliases')
    .select(COLUMNAS)
    .eq('company_id', companyId)
    .eq('customer_id', clienteId)
    .order('times_used', { ascending: false })
    .order('customer_description', { ascending: true })
    .limit(500)
  if (error) throw new Error(`No se pudo leer la memoria de productos: ${error.message}`)
  return ((data ?? []) as unknown as FilaAlias[]).map(aAlias)
}

/** `product_id` es NOT NULL: sin producto no hay equivalencia que guardar. */
function exigirProducto(datos: DatosAlias): string {
  if (!datos.productId) {
    throw new Error('Elegí el producto de Buscatools al que equivale.')
  }
  return datos.productId
}

const vacioANulo = (s: string): string | null => {
  const t = s.trim()
  return t === '' ? null : t
}

export async function crearAlias(
  companyId: string,
  clienteId: string,
  datos: DatosAlias,
): Promise<string> {
  const { data, error } = await supabase
    .from('customer_product_aliases')
    .insert({
      company_id: companyId,
      customer_id: clienteId,
      customer_code: vacioANulo(datos.codigoCliente),
      customer_description: vacioANulo(datos.descripcionCliente),
      normalized_key: claveDe(datos),
      product_id: exigirProducto(datos),
      // Se carga a mano y se da por buena: quien la escribe la está afirmando.
      // La confirmación explícita agrega QUIÉN, que es lo que a las 14
      // migradas les falta.
      status: 'confirmed',
      source: 'manual',
    })
    .select('id')
    .single()
  if (error) throw new Error(traducir(error.message, error.code))
  return data.id
}

export async function actualizarAlias(
  companyId: string,
  id: string,
  datos: DatosAlias,
): Promise<void> {
  const { error } = await supabase
    .from('customer_product_aliases')
    .update({
      customer_code: vacioANulo(datos.codigoCliente),
      customer_description: vacioANulo(datos.descripcionCliente),
      normalized_key: claveDe(datos),
      product_id: exigirProducto(datos),
    })
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(traducir(error.message, error.code))
}

/**
 * Confirmar una equivalencia.
 *
 * Deja registrado **quién** la confirmó. Las 14 que trajo la migración están
 * en `confirmed` sin persona: las dio por buenas un script, no alguien que
 * mirara la orden de compra al lado del producto.
 */
export async function confirmarAlias(
  companyId: string,
  id: string,
  usuarioId: string,
): Promise<void> {
  const { error } = await supabase
    .from('customer_product_aliases')
    .update({ status: 'confirmed', confirmed_by: usuarioId })
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(`No se pudo confirmar: ${error.message}`)
}

/**
 * Descartar una equivalencia sin borrarla.
 *
 * `rejected` es el estado que ya tenía el CHECK de la tabla. Se prefiere a
 * borrar porque deja dicho que alguien la miró y decidió que no: borrarla
 * invita a que la próxima importación la vuelva a proponer.
 */
export async function descartarAlias(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('customer_product_aliases')
    .update({ status: 'rejected' })
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(`No se pudo descartar: ${error.message}`)
}

/**
 * Borrado de verdad.
 *
 * Un alias no tiene documentos colgando —no hay FK que lo apunte—, así que
 * borrarlo no rompe ningún histórico: los documentos guardan su propio
 * `sku_snapshot` y `name_snapshot`, no dependen de la equivalencia.
 */
export async function borrarAlias(companyId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('customer_product_aliases')
    .delete()
    .eq('company_id', companyId)
    .eq('id', id)
  if (error) throw new Error(`No se pudo borrar: ${error.message}`)
}

/** Buscar el producto al que apunta una equivalencia. */
export async function buscarProductos(
  companyId: string,
  texto: string,
  limite = 20,
): Promise<ProductoBuscado[]> {
  const consulta = texto.trim()
  if (consulta.length < 2) return []

  const { data, error } = await supabase.rpc('search_products', {
    p_company: companyId,
    p_query: consulta,
    p_limit: limite,
    p_offset: 0,
    p_orden: 'nombre',
  })
  if (error) throw new Error(`No se pudieron buscar productos: ${error.message}`)

  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id)
  if (ids.length === 0) return []

  const { data: productos, error: eP } = await supabase
    .from('products')
    .select('id, sku, name, marca:brands!brand_id ( name )')
    .in('id', ids)
  if (eP) throw new Error(`No se pudieron leer los productos: ${eP.message}`)

  const porId = new Map((productos ?? []).map((p) => [p.id, p]))
  return ids
    .map((id) => porId.get(id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined)
    .map((p) => ({ id: p.id, sku: p.sku, nombre: p.name, marca: p.marca?.name ?? null }))
}

function traducir(mensaje: string, codigo?: string): string {
  if (codigo === '23505') {
    return 'Este cliente ya tiene una equivalencia con ese mismo código o descripción.'
  }
  if (codigo === '42501') return 'No tenés permiso para hacer este cambio.'
  return mensaje
}
