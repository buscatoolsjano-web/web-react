import { supabase } from '@/services/supabase/client'
import type {
  CategoriaResumen,
  DefinicionAtributo,
  ListaDePrecios,
  MarcaDelCatalogo,
} from '../types'

/** Marcas de la empresa activa. 32 filas: se cachean con staleTime largo. */
export async function listarMarcas(companyId: string): Promise<MarcaDelCatalogo[]> {
  const pedir = (columnas: string) =>
    supabase
      .from('brands')
      .select(columnas)
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('name')

  let { data, error } = await pedir('id, name, sku_prefix')

  // `sku_prefix` existe desde la Fase 45. Contra una base sin la migración
  // PostgREST responde 42703, y sin este reintento se caerían el filtro de
  // marcas del catálogo y el alta entera por una columna que sólo hace falta
  // para proponer una referencia. Degrada a lo de antes.
  if (error?.code === '42703') {
    ;({ data, error } = await pedir('id, name'))
  }

  if (error) throw new Error(`No se pudieron leer las marcas: ${error.message}`)

  type Fila = { id: string; name: string; sku_prefix?: string | null }
  return ((data ?? []) as unknown as Fila[]).map((b) => ({
    id: b.id,
    nombre: b.name,
    prefijo: b.sku_prefix ?? null,
  }))
}

/**
 * Categorías de la empresa activa, **sólo las que están en el catálogo**.
 *
 * Fase 25 · E1: el mismo `.eq('is_active', true)` que las marcas. Sin esto, una
 * categoría desactivada seguiría apareciendo en el filtro y elegirla daría cero
 * resultados, porque `search_products` ya no devuelve sus productos. Un filtro
 * que siempre da cero es peor que un filtro que no está.
 */
export async function listarCategorias(companyId: string): Promise<CategoriaResumen[]> {
  const { data, error } = await supabase
    .from('product_categories')
    .select('id, name, slug, needs_review, position')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('position')

  if (error) throw new Error(`No se pudieron leer las categorías: ${error.message}`)
  return (data ?? []).map((c) => ({
    id: c.id,
    nombre: c.name,
    slug: c.slug,
    necesitaRevision: c.needs_review,
  }))
}

function tipoDeDato(v: string): DefinicionAtributo['tipo'] {
  return v === 'number' || v === 'boolean' ? v : 'text'
}

/**
 * Definiciones de atributos de la empresa.
 *
 * Se traen TODAS (26 filas) y no sólo las filtrables: el detalle del
 * producto necesita la etiqueta y la unidad de cualquier clave, sea
 * filtrable o no.
 */
const COLUMNAS_BASE = 'key, label, unit, data_type, is_filterable, position'
const COLUMNAS_CON_RANGO = 'range_group, range_role, range_label'

const COLUMNAS_CON_OPCIONES = `${COLUMNAS_BASE}, is_enumerated, show_in_sheet, product_attribute_options ( value, position ), ${COLUMNAS_CON_RANGO}`

export async function listarDefinicionesDeAtributos(
  companyId: string,
): Promise<DefinicionAtributo[]> {
  const pedir = (columnas: string) =>
    supabase
      .from('product_attribute_definitions')
      .select(columnas)
      .eq('company_id', companyId)
      .order('position')
      .order('key')

  let { data, error } = await pedir(COLUMNAS_CON_OPCIONES)

  // La lista cerrada de valores vive sólo en la base de São Paulo (Fase 30), y
  // `show_in_sheet` sólo a partir de la Fase 43. Contra una base que todavía no
  // las tiene, PostgREST responde 42703 y sin este reintento se caería TODO el
  // catálogo —etiquetas, unidades y filtros— por una columna que sólo hace
  // falta para el alta y para la ficha. Degrada a lo de antes: texto libre, y
  // todos los atributos visibles.
  if (error?.code === '42703') {
    ;({ data, error } = await pedir(COLUMNAS_BASE))
  }

  if (error) throw new Error(`No se pudieron leer los atributos: ${error.message}`)

  type Fila = {
    key: string
    label: string
    unit: string | null
    data_type: string
    is_filterable: boolean
    position: number
    is_enumerated?: boolean
    show_in_sheet?: boolean
    product_attribute_options?: { value: string; position: number }[]
    /* El par de rango (Fase 57). Opcionales como el resto de lo que vino
       después: contra una base sin la migración, el reintento de abajo pide
       sólo las columnas base y estos quedan sin definir. */
    range_group?: string | null
    range_role?: string | null
    range_label?: string | null
  }

  return ((data ?? []) as unknown as Fila[]).map((d) => ({
    key: d.key,
    label: d.label,
    unidad: d.unit,
    tipo: tipoDeDato(d.data_type),
    filtrable: d.is_filterable,
    posicion: d.position,
    enumerada: d.is_enumerated ?? false,
    // Sin la columna (base sin la migración) se muestra, que es como
    // funcionaba antes: esconder de más es peor que mostrar de más.
    enFicha: d.show_in_sheet ?? true,
    // Las tres columnas del par van juntas o no va ninguna: lo garantiza un
    // check en la base, asi que alcanza con mirar una.
    rango:
      d.range_group && (d.range_role === 'min' || d.range_role === 'max')
        ? { grupo: d.range_group, rol: d.range_role, label: d.range_label ?? d.range_group }
        : null,
    // PostgREST no garantiza el orden de los embebidos: se ordena acá, por
    // posición —que sale de cuántos productos usan cada valor— y después
    // alfabético, para que la lista salga siempre igual.
    opciones: (d.product_attribute_options ?? [])
      .slice()
      .sort((a, b) => a.position - b.position || a.value.localeCompare(b.value, 'es'))
      .map((o) => o.value),
  }))
}

/**
 * Qué atributos aplican a cada categoría.
 *
 * Sale de `product_attribute_categories`, la relación N:N. Son 70 filas
 * derivadas de los productos reales: cada par existe porque hay al menos un
 * producto de esa categoría con esa clave cargada.
 *
 * Devuelve un Map categoryId → claves.
 */
export async function listarAtributosPorCategoria(
  companyId: string,
): Promise<Map<string, Set<string>>> {
  const { data, error } = await supabase
    .from('product_attribute_categories')
    .select('category_id, product_attribute_definitions ( key )')
    .eq('company_id', companyId)

  if (error) {
    throw new Error(`No se pudieron leer los atributos por categoría: ${error.message}`)
  }

  const mapa = new Map<string, Set<string>>()
  for (const fila of data ?? []) {
    const clave = fila.product_attribute_definitions?.key
    if (!clave) continue
    const set = mapa.get(fila.category_id) ?? new Set<string>()
    set.add(clave)
    mapa.set(fila.category_id, set)
  }
  return mapa
}


/**
 * Cuál lista usar si el usuario no eligió ninguna.
 *
 * `is_default` está por empresa (hay dos listas llamadas "Lista base", una
 * por empresa), así que la lista ya viene filtrada por company_id antes de
 * llegar acá.
 */
export function listaPorDefecto(listas: readonly ListaDePrecios[]): ListaDePrecios | null {
  return listas.find((l) => l.esPorDefecto) ?? listas[0] ?? null
}

// ── Facetas dependientes (Fase 3.6) ────────────────────────────────────────

import type { PlanDeConsulta } from '../lib/planDeConsulta'
import { clasificarFaceta } from '../lib/clasificarFaceta'
import { atributosEnOrden, type AtributosCrudos } from '../lib/ordenDeAtributos'
import type { Facetas } from '../types'

/** Forma cruda que devuelve `public.catalog_facets`. */
interface RespuestaFacetas {
  total: number
  brands: { id: string; name: string; count: number }[]
  categories: { id: string; slug: string; name: string; count: number }[]
  product_types: { value: string; count: number }[]
  series: { value: string; count: number }[]
  /**
   * Array desde la Fase 43; objeto `{clave: {…}}` antes. Ver
   * `atributosEnOrden`, que acepta las dos.
   */
  attributes: AtributosCrudos
}


/**
 * Opciones disponibles para cada filtro, dado el contexto de filtros actual.
 *
 * Cada faceta se calcula en el servidor con TODOS los filtros activos MENOS
 * el suyo, para que se pueda cambiar de opción sin limpiar primero. Nunca
 * devuelve un valor con conteo 0: si no está en la lista, no existe.
 *
 * La RPC es SECURITY INVOKER: los conteos salen de lo que RLS deja ver, así
 * que un externo no puede inferir por ellos productos que no puede leer.
 */
export async function obtenerFacetas(plan: PlanDeConsulta): Promise<Facetas> {
  // Los parámetros ausentes se OMITEN en vez de mandarse en null: los tipos
  // generados los marcan opcionales porque tienen DEFAULT NULL en la función,
  // y con `exactOptionalPropertyTypes` pasar un undefined explícito no es lo
  // mismo que no pasar la clave. El resultado en la base es idéntico.
  const { data, error } = await supabase.rpc('catalog_facets', {
    p_company: plan.companyId,
    ...(plan.texto !== null && { p_query: plan.texto }),
    ...(plan.categoria !== null && { p_category: plan.categoria }),
    ...(plan.marca !== null && { p_brand: plan.marca }),
    ...(plan.subtipos !== null && { p_type: plan.subtipos }),
    ...(plan.serie !== null && { p_series: [plan.serie] }),
    p_attrs: plan.atributos,
    p_ranges: plan.rangos,
    // Fase 22: las facetas cuentan lo MISMO que el listado. Sin esto, el
    // filtro prometía 4.200 productos de una marca desactivada y la lista
    // mostraba cero.
    p_solo_catalogo: true,
  })

  if (error) throw new Error(`No se pudieron leer los filtros: ${error.message}`)

  const r = (data ?? {
    total: 0, brands: [], categories: [], product_types: [], series: [], attributes: [],
    // `as unknown as`: la RPC está tipada como `Json`, y desde que
    // `attributes` puede ser un array el tipo generado ya no solapa lo
    // suficiente para un cast directo. La forma se valida en
    // `atributosEnOrden`, que acepta las dos y no confía en el tipo.
  }) as unknown as RespuestaFacetas

  return {
    total: Number(r.total ?? 0),
    marcas: (r.brands ?? []).map((b) => ({
      valor: b.id, etiqueta: b.name, cantidad: b.count,
    })),
    categorias: (r.categories ?? []).map((c) => ({
      valor: c.id, etiqueta: c.name, cantidad: c.count,
    })),
    subtipos: (r.product_types ?? []).map((t) => ({
      valor: t.value, etiqueta: t.value, cantidad: t.count,
    })),
    series: (r.series ?? []).map((t) => ({
      valor: t.value, etiqueta: t.value, cantidad: t.count,
    })),
    atributos: atributosEnOrden(r.attributes).map((a) =>
      clasificarFaceta(a.key, a.label, a.unit, a.values),
    ),
  }
}
