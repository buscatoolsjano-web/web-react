import { supabase } from '@/services/supabase/client'
import type { PlanDeConsulta } from '../lib/planDeConsulta'
import { ordenarPorRelevancia, type PosicionDeRelevancia } from '../lib/relevancia'
import type {
  ImagenProducto,
  PaginaDeProductos,
  ProductoDetalle,
  ProductoListado,
} from '../types'

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
  product_prices ( amount, price_list_id ),
  product_images ( source_url, thumb_url, kind, position, is_primary )
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
  product_prices ( amount, price_list_id ),
  product_images ( source_url, thumb_url, kind, position, is_primary )
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
  product_images: FilaImagen[] | null
  stock_balances?: { on_hand: number; reserved: number }[] | null
}

interface FilaImagen {
  source_url: string | null
  thumb_url: string | null
  kind: string
  position: number
  is_primary: boolean
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

const CLASES_IMAGEN = new Set(['product_image', 'shared_diagram', 'technical_diagram', 'unknown'])

function mapearImagen(f: FilaImagen): ImagenProducto | null {
  if (!f.source_url) return null
  return {
    url: f.source_url,
    // thumb_url sólo viene poblada si la verificación offline la encontró
    // con HTTP 200. Nunca se deriva reescribiendo el nombre del archivo:
    // medido, el 51 % de las de WordPress no tiene miniatura y el 100 % de
    // las de apexbits tampoco.
    thumbUrl: f.thumb_url,
    kind: (CLASES_IMAGEN.has(f.kind) ? f.kind : 'unknown') as ImagenProducto['kind'],
    posicion: f.position,
    esPrincipal: f.is_primary,
  }
}

function mapearImagenes(filas: FilaImagen[] | null): ImagenProducto[] {
  return (filas ?? [])
    .map(mapearImagen)
    .filter((i): i is ImagenProducto => i !== null)
    .sort((a, b) => a.posicion - b.posicion)
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
    // Sólo una FOTO puede ser principal. Un producto cuya única imagen sea
    // un diagrama de catálogo compartido queda sin imagen y muestra el
    // placeholder: 3.544 productos están en ese caso, y fingir que tienen
    // foto sería peor que no mostrar nada.
    imagen: mapearImagenes(f.product_images).find((i) => i.esPrincipal) ?? null,
  }
}

function mapearDetalle(f: FilaProductoDetalle): ProductoDetalle {
  return {
    ...mapearListado(f),
    imagenes: mapearImagenes(f.product_images),
    modelo: f.model_code,
    descripcion: f.description,
    descripcionLarga: f.description_long,
    origen: f.origin_country,
    ncm: f.ncm_code,
    pesoG: f.weight_g,
    volumenCm3: f.volume_cm3,
  }
}

/**
 * Consulta del catálogo: listado y búsqueda, por el mismo camino.
 *
 * Desde la Fase 3.6 hay UNA sola definición de qué productos entran, dentro
 * de `search_products`. Antes el listado armaba su propia cadena de
 * PostgREST y la búsqueda usaba la RPC; mantener las dos en paralelo con
 * multiselección y rangos era pedir que el total del paginador y el de las
 * facetas se desincronizaran. Ya pasó una vez: el paginador decía
 * "1–50 de 407" mostrando 48 filas, porque el conteo no aplicaba los filtros.
 *
 * Son dos pasos porque la RPC devuelve sólo ids y score. Las columnas salen
 * de la MISMA consulta en los dos casos, así que no existe una segunda
 * definición de qué ve cada rol — que es donde suelen aparecer las
 * filtraciones.
 */
export async function consultarProductos(
  plan: PlanDeConsulta,
  priceListId: string | null,
  esInterno: boolean,
): Promise<PaginaDeProductos> {
  const { data: ranking, error: errorRpc } = await supabase.rpc('search_products', {
    p_company: plan.companyId,
    p_query: plan.texto,
    p_limit: plan.limite,
    p_offset: plan.desplazamiento,
    p_category: plan.categoria,
    p_brand: plan.marca,
    p_attrs: plan.atributos,
    p_type: plan.subtipos,
    p_ranges: plan.rangos,
    p_orden: plan.orden,
  })

  if (errorRpc) throw new Error(`No se pudo leer el catálogo: ${errorRpc.message}`)

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
    // Del listado sólo se trae la imagen PRINCIPAL: la segunda no se muestra
    // y bajarla sería peso puro. En el detalle sí vienen todas.
    .eq('product_images.is_primary', true)

  // Los filtros ya los aplicó la RPC; no hace falta repetirlos acá. Sólo se
  // acota el precio a la lista vigente.
  if (priceListId) q = q.eq('product_prices.price_list_id', priceListId)

  const { data, error } = await q
  if (error) throw new Error(`No se pudieron leer los resultados: ${error.message}`)

  const filas = (data ?? []) as unknown as FilaProducto[]

  // `.in()` NO conserva el orden de los ids. Sin esto se pierde el orden que
  // calculó Postgres —relevancia si hay búsqueda, nombre o SKU si no— y las
  // filas salen en orden arbitrario.
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

  const { data, error } = await q
    .order('position', { referencedTable: 'product_images', ascending: true })
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el producto: ${error.message}`)
  if (!data) return null

  return mapearDetalle(data as unknown as FilaProductoDetalle)
}
