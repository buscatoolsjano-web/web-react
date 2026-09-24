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
  brands ( id, name, is_active ),
  product_categories ( id, name, slug, is_active ),
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
  brands ( id, name, is_active ),
  product_categories ( id, name, slug, is_active ),
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
  brands: { id: string; name: string; is_active?: boolean } | null
  product_categories: { id: string; name: string; slug: string; is_active?: boolean } | null
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

/**
 * Por qué un producto no está en el catálogo, cuando no está.
 *
 * Desde la Fase 25 · E1 hay dos interruptores —la marca y la categoría— y el
 * cartel del modal tiene que decir cuál, porque cuál es lo que hay que ir a
 * tocar en Configuración para arreglarlo.
 */
function motivoFuera(f: FilaProducto): ProductoListado['motivoFueraDelCatalogo'] {
  const marcaFuera = f.brands ? f.brands.is_active === false : false
  const categoriaFuera = f.product_categories ? f.product_categories.is_active === false : false
  if (marcaFuera && categoriaFuera) return 'ambas'
  if (marcaFuera) return 'marca'
  if (categoriaFuera) return 'categoria'
  return null
}

function mapearListado(f: FilaProducto): ProductoListado {
  // El embed viene filtrado por price_list_id, así que hay 0 o 1 fila.
  const precio = f.product_prices?.[0]?.amount ?? null
  const motivoFueraDelCatalogo = motivoFuera(f)

  return {
    id: f.id,
    sku: f.sku,
    nombre: f.name,
    serie: f.series,
    tipo: f.product_type,
    esKit: f.is_kit,
    necesitaRevision: f.needs_review,
    marca: f.brands ? { id: f.brands.id, nombre: f.brands.name } : null,
    // Fase 22 · B: si la marca está desactivada, el producto NO está en el
    // catálogo. Se puede llegar por un link viejo o desde un documento, y la
    // pantalla lo aclara en vez de hacer como si nada.
    //
    // Fase 25 · E1: la categoría desactivada hace exactamente lo mismo. Las
    // dos condiciones están del lado del servidor dentro de `search_products`;
    // esto es sólo para lo que se abre por id o por SKU, que no pasa por ahí.
    enCatalogo: motivoFueraDelCatalogo === null,
    motivoFueraDelCatalogo,
    categoria: f.product_categories
      ? {
          id: f.product_categories.id,
          nombre: f.product_categories.name,
          // El `slug` es lo estable: el nombre visible se puede editar, y el
          // comparador decide por familia («punta», «balanceador»).
          slug: f.product_categories.slug,
        }
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
    // Ver la nota en facetas.ts: los ausentes se omiten, no se mandan en
    // null. Todos tienen DEFAULT NULL en la función.
    ...(plan.texto !== null && { p_query: plan.texto }),
    p_limit: plan.limite,
    p_offset: plan.desplazamiento,
    ...(plan.categoria !== null && { p_category: plan.categoria }),
    ...(plan.marca !== null && { p_brand: plan.marca }),
    p_attrs: plan.atributos,
    ...(plan.subtipos !== null && { p_type: plan.subtipos }),
    p_ranges: plan.rangos,
    p_orden: plan.orden,
    // Fase 22 · B: el catálogo NO muestra productos de marcas desactivadas.
    // «Sacar del catálogo» dejaba la marca fuera de los filtros y sus 3.807
    // productos seguían en la lista. El filtro va en la consulta —que es la
    // que pagina y cuenta— y no en un .filter() de React, que daría páginas
    // de tamaños raros y un total que no coincide con lo que se ve.
    //
    // Ventas NO manda esta bandera: se puede sacar un producto del catálogo
    // comercial sin perder la capacidad de cotizarlo.
    p_solo_catalogo: true,
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
/**
 * El producto por su uuid, para el modal del catálogo (Fase 21 · E1).
 *
 * Misma consulta que por SKU —mismas columnas, misma lista de precios, mismo
 * `esInterno`— cambiando sólo por dónde se lo busca. El modal usa el uuid
 * porque es lo que viaja en la URL (`?producto=<uuid>`): un SKU puede tener
 * barras y eñes y termina escapado tres veces.
 */
export async function obtenerProductoPorId(
  companyId: string,
  id: string,
  priceListId: string | null,
  esInterno: boolean,
): Promise<ProductoDetalle | null> {
  let q = supabase
    .from('products')
    .select(esInterno ? COLUMNAS_DETALLE_INTERNO : COLUMNAS_DETALLE)
    .eq('company_id', companyId)
    .eq('id', id)
    .is('deleted_at', null)

  if (priceListId) q = q.eq('product_prices.price_list_id', priceListId)

  const { data, error } = await q
    .order('position', { referencedTable: 'product_images', ascending: true })
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el producto: ${error.message}`)
  if (!data) return null

  return mapearDetalle(data as unknown as FilaProductoDetalle)
}

/**
 * Los productos hermanos: **misma marca, misma serie y mismo tipo**.
 *
 * Las tres son columnas reales del producto, no una semejanza de nombres. Un
 * `SP.2520/8B` («SPEEDRILL · Adaptador · Adaptador») trae a sus vecinos de
 * medida, que es exactamente lo que el sistema anterior mostraba como
 * «productos relacionados» —y lo que alguien busca cuando tiene el de 8 en la
 * mano y necesita el de 10.
 *
 * NO se relaciona por parecido de texto. Si el producto no tiene serie o no
 * tiene tipo, no hay familia y no se muestra nada: es preferible una sección
 * vacía a una lista de productos que no son variantes de éste.
 */
export async function relacionadosDe(
  companyId: string,
  producto: Pick<ProductoDetalle, 'id' | 'sku' | 'serie' | 'tipo' | 'marca'>,
  priceListId: string | null,
  limite = 8,
): Promise<ProductoListado[]> {
  if (!producto.marca || !producto.serie || !producto.tipo) return []

  let q = supabase
    .from('products')
    // Fase 22 · B: los relacionados son de la MISMA marca, así que si esa
    // marca está fuera del catálogo no hay nada que recomendar. El `!inner`
    // no es decorativo: con el join normal PostgREST devuelve el producto
    // igual y deja la marca en nulo, y se colarían los que hay que esconder.
    .select(COLUMNAS_LISTADO.replace('brands (', 'brands!inner ('))
    .eq('company_id', companyId)
    .eq('brand_id', producto.marca.id)
    .eq('brands.is_active', true)
    .eq('series', producto.serie)
    .eq('product_type', producto.tipo)
    .neq('id', producto.id)
    .is('deleted_at', null)

  if (priceListId) q = q.eq('product_prices.price_list_id', priceListId)

  // Se piden más de los que se muestran: los de la misma familia de SKU se
  // ordenan primero acá abajo, y con `limit` justo podrían quedar afuera.
  const { data, error } = await q.order('sku', { ascending: true }).limit(limite * 6)
  if (error) throw new Error(`No se pudieron leer los relacionados: ${error.message}`)

  const familia = familiaDeSku(producto.sku)
  return (data ?? [])
    .map((f) => mapearListado(f as unknown as FilaProducto))
    .sort((a, b) => {
      // Primero los de la misma raíz de SKU —`SP.2520/8B` y `SP.2520/10B` son
      // el mismo producto en otra medida—, después el resto de la serie.
      const ma = familia !== null && familiaDeSku(a.sku) === familia ? 0 : 1
      const mb = familia !== null && familiaDeSku(b.sku) === familia ? 0 : 1
      return ma !== mb ? ma - mb : a.sku.localeCompare(b.sku, 'es', { numeric: true })
    })
    .slice(0, limite)
}

/**
 * La raíz del código del fabricante: `SP.2520/8B` → `SP.2520`.
 *
 * Sin barra no hay familia. No es una heurística sobre el nombre: es la
 * numeración de parte del propio fabricante, donde lo que va después de la
 * barra es la medida o la variante.
 */
export function familiaDeSku(sku: string): string | null {
  const i = sku.lastIndexOf('/')
  return i > 0 ? sku.slice(0, i) : null
}

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

/**
 * Productos similares por familia técnica (Fase 22 · Etapa B).
 *
 * Reemplaza a `relacionadosDe` como fuente de «parecidos». La diferencia no es
 * de implementación, es de resultado: aquélla exigía misma marca + misma serie
 * + mismo tipo, así que nunca proponía la alternativa de OTRA marca —que es lo
 * que uno busca cuando compara— y devolvía vacío para los 12.637 productos sin
 * datos técnicos.
 *
 * El puntaje lo calcula `productos_similares` en la base, sobre todo el
 * catálogo y no sobre la página que se está viendo. Acá sólo se hidratan las
 * filas con las MISMAS columnas del listado, así el comparador tiene atributos,
 * precio, stock e imagen sin inventar una segunda forma de leer un producto.
 *
 * Dos consultas por producto —el puntaje y las filas—, y las dos las cachea
 * TanStack Query: recorrer el listado dos veces no vuelve a pedir nada.
 */
export async function similaresDe(
  companyId: string,
  productId: string,
  priceListId: string | null,
  esInterno: boolean,
  limite = 6,
): Promise<SimilaresDeProducto> {
  const { data: puntajes, error: errorRpc } = await supabase.rpc('productos_similares', {
    p_product_id: productId,
    p_limite: limite,
  })
  if (errorRpc) throw new Error(`No se pudieron buscar similares: ${errorRpc.message}`)

  const filas = puntajes ?? []
  if (filas.length === 0) return { productos: [], fuentes: new Map() }

  let q = supabase
    .from('products')
    .select(esInterno ? COLUMNAS_LISTADO_INTERNO : COLUMNAS_LISTADO)
    .eq('company_id', companyId)
    .in('id', filas.map((f) => f.id))
    .eq('product_images.is_primary', true)
  if (priceListId) q = q.eq('product_prices.price_list_id', priceListId)

  const { data, error } = await q
  if (error) throw new Error(`No se pudieron leer los similares: ${error.message}`)

  // `.in()` no conserva el orden, y acá el orden ES el resultado: lo calculó
  // la base por cercanía técnica. Sin esto los similares salen alfabéticos.
  const porId = new Map((data ?? []).map((f) => [(f as unknown as FilaProducto).id, f]))
  return {
    productos: filas
      .map((f) => porId.get(f.id))
      .filter((f): f is NonNullable<typeof f> => f !== undefined)
      .map((f) => mapearListado(f as unknown as FilaProducto)),
    // De dónde salió cada uno. La pantalla lo necesita para decir «equivalente»
    // sin pedir nada más, y viene en la MISMA consulta que el puntaje.
    fuentes: new Map(filas.map((f) => [f.id, f.fuente === 'legacy' ? ('legacy' as const) : ('calculated' as const)])),
  }
}

/**
 * Los similares de un producto, con su procedencia.
 *
 * `fuentes` distingue la equivalencia CURADA —alguien de Buscatools la
 * declaró— de la calculada por atributos. La curada va primero, pero eso no
 * cambia los colores del comparador: sigue mostrando en rojo lo que difiere,
 * que es justamente por qué sirve.
 */
export interface SimilaresDeProducto {
  productos: ProductoListado[]
  fuentes: Map<string, 'legacy' | 'calculated'>
}

/**
 * Todo lo que coincide con el filtro, no sólo la página (Fase 22 · paridad, #49).
 *
 * La exportación tiene que dar **lo que se está viendo**: si alguien filtró 37
 * productos, el archivo tiene 37, no 21.828. Pero la pantalla sólo pidió 50,
 * así que hace falta recorrer el resto — de a 500, con el mismo plan y el
 * mismo orden. Es la misma consulta paginada, no una segunda definición de
 * qué entra.
 *
 * El lote es de 500 y no más: el segundo paso hidrata los productos con un
 * `.in(ids)`, y con mil uuid la URL de PostgREST pasa los 37 KB y el
 * servidor devuelve 400. Medido.
 *
 * El tope es alto a propósito —el catálogo entero son 17.996 productos y el
 * legacy los exporta— pero existe: si alguna vez son 100.000, es mejor
 * avisar que colgar la pestaña. Si se llega, se avisa en vez de entregar un
 * archivo cortado en silencio.
 */
export const TOPE_EXPORTACION = 25_000

/** Cada lote traído, para poder decir «llevo 3.500 de 17.996». */
export type AvanceExportacion = (traidos: number, total: number) => void

export async function consultarTodosLosProductos(
  plan: PlanDeConsulta,
  priceListId: string | null,
  esInterno: boolean,
  opciones: { tope?: number; onAvance?: AvanceExportacion } = {},
): Promise<{ productos: ProductoListado[]; total: number; truncado: boolean }> {
  const tope = opciones.tope ?? TOPE_EXPORTACION
  const LOTE = 500
  const productos: ProductoListado[] = []
  let total = 0

  for (let desde = 0; desde < tope; desde += LOTE) {
    const pagina = await consultarProductos(
      { ...plan, desplazamiento: desde, limite: Math.min(LOTE, tope - desde) },
      priceListId,
      esInterno,
    )
    total = pagina.total
    productos.push(...pagina.productos)
    opciones.onAvance?.(productos.length, total)
    if (pagina.productos.length === 0 || productos.length >= pagina.total) break
  }

  return { productos, total, truncado: total > productos.length }
}

/**
 * Cuántos productos hay en el catálogo, sin ningún filtro.
 *
 * Lo necesita el modal de exportación para el radio «Todo el catálogo (n)».
 * Se pide el mínimo: una fila, sólo por el `total_count` que la RPC devuelve
 * repetido en cada una.
 */
export async function contarCatalogoCompleto(companyId: string): Promise<number> {
  const { data, error } = await supabase.rpc('search_products', {
    p_company: companyId,
    p_limit: 1,
    p_offset: 0,
    p_orden: 'nombre',
    p_solo_catalogo: true,
  })
  if (error) throw new Error(`No se pudo contar el catálogo: ${error.message}`)
  return Number(data?.[0]?.total_count ?? 0)
}
