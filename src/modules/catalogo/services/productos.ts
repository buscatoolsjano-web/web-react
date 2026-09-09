import { supabase } from '@/services/supabase/client'
import type { PlanDeConsulta } from '../lib/planDeConsulta'
import { ordenarPorRelevancia, type PosicionDeRelevancia } from '../lib/relevancia'
import type { PaginaDeProductos, ProductoDetalle, ProductoListado } from '../types'

/**
 * Columnas del listado.
 *
 * Nunca `select('*')`. Cada columna que sobra son bytes que viajan al
 * navegador de un cliente, y el legacy mandaba las 55 de cada uno de los
 * 21.772 productos.
 *
 * `product_prices` se embebe filtrado por lista; RLS decide de antemano qué
 * listas puede ver este usuario, así que un externo no puede pedir la lista
 * de otro. `stock_balances` sólo se pide para roles internos.
 */
const COLUMNAS_LISTADO = `
  id, sku, name, series, product_type, attributes, is_kit, needs_review,
  brands ( id, name ),
  product_categories ( id, name ),
  product_prices ( amount, price_list_id )
` as const

const COLUMNAS_LISTADO_INTERNO = `
  ${COLUMNAS_LISTADO},
  stock_balances ( on_hand, reserved )
` as const

const COLUMNAS_DETALLE = `
  id, sku, name, series, product_type, attributes, is_kit, needs_review,
  model_code, description, description_long, origin_country, ncm_code,
  weight_g, volume_cm3,
  brands ( id, name ),
  product_categories ( id, name ),
  product_prices ( amount, price_list_id )
` as const

const COLUMNAS_DETALLE_INTERNO = `
  ${COLUMNAS_DETALLE},
  stock_balances ( on_hand, reserved )
` as const

/** Forma cruda que devuelve PostgREST. */
interface FilaProducto {
  id: string
  sku: string
  name: string
  series: string | null
  product_type: string | null
  attributes: unknown
  is_kit: boolean
  needs_review: boolean
  brands: { id: string; name: string } | null
  product_categories: { id: string; name: string } | null
  product_prices: { amount: number; price_list_id: string }[] | null
  stock_balances?: { on_hand: number; reserved: number }[] | null
}

interface FilaProductoDetalle extends FilaProducto {
  model_code: string | null
  description: string | null
  description_long: string | null
  origin_country: string | null
  ncm_code: string | null
  weight_g: number | null
  volume_cm3: number | null
}

function atributosDe(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

/**
 * Suma los saldos de todos los depósitos.
 *
 * Hoy hay un depósito por empresa, pero el modelo admite varios y la
 * consulta devuelve una fila por depósito. Sumar 1 o 2 filas de la página
 * actual no es el antipatrón del legacy: aquel sumaba sobre 21.772.
 *
 * Devuelve null (no cero) si no llegó ninguna fila: para un rol externo RLS
 * deniega la tabla, y "no sé" no es lo mismo que "hay cero".
 */
function agregarStock(filas: FilaProducto['stock_balances']): ProductoListado['stock'] {
  if (!filas || filas.length === 0) return null
  let real = 0
  let reservado = 0
  for (const f of filas) {
    real += f.on_hand
    reservado += f.reserved
  }
  return { real, virtual: real - reservado }
}

function mapearListado(f: FilaProducto): ProductoListado {
  // El embed viene filtrado por price_list_id, así que hay 0 o 1 fila.
  const precio = f.product_prices?.[0]?.amount ?? null

  return {
    id: f.id,
    sku: f.sku,
    nombre: f.name,
    serie: f.series,
    tipo: f.product_type,
    esKit: f.is_kit,
    necesitaRevision: f.needs_review,
    marca: f.brands ? { id: f.brands.id, nombre: f.brands.name } : null,
    categoria: f.product_categories
      ? { id: f.product_categories.id, nombre: f.product_categories.name }
      : null,
    atributos: atributosDe(f.attributes),
    precio,
    stock: agregarStock(f.stock_balances),
    disponible: null,
  }
}

function mapearDetalle(f: FilaProductoDetalle): ProductoDetalle {
  return {
    ...mapearListado(f),
    modelo: f.model_code,
    descripcion: f.description,
    descripcionLarga: f.description_long,
    origen: f.origin_country,
    ncm: f.ncm_code,
    pesoG: f.weight_g,
    volumenCm3: f.volume_cm3,
  }
}

/** Listado paginado sin búsqueda de texto. */
export async function listarProductos(
  plan: PlanDeConsulta,
  priceListId: string | null,
  esInterno: boolean,
): Promise<PaginaDeProductos> {
  let q = supabase
    .from('products')
    .select(esInterno ? COLUMNAS_LISTADO_INTERNO : COLUMNAS_LISTADO, { count: 'exact' })
    .eq('company_id', plan.companyId)
    .is('deleted_at', null)
    .eq('status', 'active')

  for (const [col, val] of Object.entries(plan.eq)) q = q.eq(col, val)
  if (Object.keys(plan.atributos).length > 0) q = q.contains('attributes', plan.atributos)

  // Filtro sobre el recurso embebido: acota QUÉ precio se trae, no qué
  // productos. Sin `!inner`, un producto sin precio igual aparece — hace
  // falta, porque 92 de 219 no tienen precio.
  if (priceListId) q = q.eq('product_prices.price_list_id', priceListId)

  const { data, error, count } = await q
    .order(plan.orden.columna, { ascending: plan.orden.ascendente })
    .range(plan.rango.desde, plan.rango.hasta)

  if (error) throw new Error(`No se pudo leer el catálogo: ${error.message}`)

  const filas = (data ?? []) as unknown as FilaProducto[]
  return { productos: filas.map(mapearListado), total: count ?? 0 }
}

/**
 * Búsqueda server-side: full-text + fuzzy, ordenada por relevancia.
 *
 * Son dos pasos porque la RPC devuelve sólo ids y score. Los datos vienen
 * de la MISMA consulta que el listado, así que no existe una segunda
 * definición de qué columnas ve cada rol — que es donde suelen aparecer las
 * filtraciones.
 */
export async function buscarProductos(
  plan: PlanDeConsulta,
  texto: string,
  priceListId: string | null,
  esInterno: boolean,
): Promise<PaginaDeProductos> {
  const porPagina = plan.rango.hasta - plan.rango.desde + 1

  // Los filtros van DENTRO de la RPC. Si se aplicaran sólo en la segunda
  // consulta, `total_count` contaría el conjunto sin filtrar: medido en
  // producción, el paginador decía "1–50 de 407" mostrando 48 filas.
  const { data: ranking, error: errorRpc } = await supabase.rpc('search_products', {
    p_company: plan.companyId,
    p_query: texto,
    p_limit: porPagina,
    p_offset: plan.rango.desde,
    p_category: plan.eq['category_id'] ?? null,
    p_brand: plan.eq['brand_id'] ?? null,
    p_attrs: Object.keys(plan.atributos).length > 0 ? plan.atributos : null,
  })

  if (errorRpc) throw new Error(`La búsqueda falló: ${errorRpc.message}`)

  const filasRanking = (ranking ?? []) as PosicionDeRelevancia[] &
    { total_count: number }[]

  if (filasRanking.length === 0) return { productos: [], total: 0 }

  // total_count viene repetido en cada fila (count(*) OVER ()).
  const total = Number(filasRanking[0]?.total_count ?? 0)
  const ids = filasRanking.map((r) => r.id)

  let q = supabase
    .from('products')
    .select(esInterno ? COLUMNAS_LISTADO_INTERNO : COLUMNAS_LISTADO)
    .eq('company_id', plan.companyId)
    .in('id', ids)

  // Los filtros ya los aplicó la RPC; no hace falta repetirlos acá. Sólo
  // se acota el precio a la lista vigente.
  if (priceListId) q = q.eq('product_prices.price_list_id', priceListId)

  const { data, error } = await q
  if (error) throw new Error(`No se pudieron leer los resultados: ${error.message}`)

  const filas = (data ?? []) as unknown as FilaProducto[]

  // `.in()` NO conserva el orden de los ids. Sin esto, el ranking por score
  // que calculó Postgres se pierde y los resultados salen en orden arbitrario.
  const ordenadas = ordenarPorRelevancia(filas, filasRanking)

  return { productos: ordenadas.map(mapearListado), total }
}

/**
 * Detalle por SKU dentro de la empresa activa.
 *
 * El SKU es único por empresa (`products_company_id_sku_key`), así que el
 * mismo SKU puede existir en Buscatools y en Torquetools: la empresa activa
 * determina cuál se consulta.
 */
export async function obtenerProductoPorSku(
  companyId: string,
  sku: string,
  priceListId: string | null,
  esInterno: boolean,
): Promise<ProductoDetalle | null> {
  let q = supabase
    .from('products')
    .select(esInterno ? COLUMNAS_DETALLE_INTERNO : COLUMNAS_DETALLE)
    .eq('company_id', companyId)
    .eq('sku', sku)
    .is('deleted_at', null)

  if (priceListId) q = q.eq('product_prices.price_list_id', priceListId)

  const { data, error } = await q.maybeSingle()
  if (error) throw new Error(`No se pudo leer el producto: ${error.message}`)
  if (!data) return null

  return mapearDetalle(data as unknown as FilaProductoDetalle)
}
