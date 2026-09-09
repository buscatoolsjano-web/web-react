import { supabase } from '@/services/supabase/client'
import type {
  CategoriaResumen,
  DefinicionAtributo,
  ListaDePrecios,
  MarcaResumen,
} from '../types'

/** Marcas de la empresa activa. 25 filas: se cachean con staleTime largo. */
export async function listarMarcas(companyId: string): Promise<MarcaResumen[]> {
  const { data, error } = await supabase
    .from('brands')
    .select('id, name')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('name')

  if (error) throw new Error(`No se pudieron leer las marcas: ${error.message}`)
  return (data ?? []).map((b) => ({ id: b.id, nombre: b.name }))
}

export async function listarCategorias(companyId: string): Promise<CategoriaResumen[]> {
  const { data, error } = await supabase
    .from('product_categories')
    .select('id, name, slug, needs_review, position')
    .eq('company_id', companyId)
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
export async function listarDefinicionesDeAtributos(
  companyId: string,
): Promise<DefinicionAtributo[]> {
  const { data, error } = await supabase
    .from('product_attribute_definitions')
    .select('key, label, unit, data_type, is_filterable, position')
    .eq('company_id', companyId)
    .order('position')
    .order('key')

  if (error) throw new Error(`No se pudieron leer los atributos: ${error.message}`)
  return (data ?? []).map((d) => ({
    key: d.key,
    label: d.label,
    unidad: d.unit,
    tipo: tipoDeDato(d.data_type),
    filtrable: d.is_filterable,
    posicion: d.position,
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
 * Listas de precios visibles para el usuario.
 *
 * No filtra por rol: RLS ya devuelve las que corresponden. Un usuario
 * interno recibe las 3 de su empresa; un customer, sólo la suya; un
 * distributor, sólo "Distribuidores". La UI elige entre lo que llegó, y
 * nunca decide un precio por su cuenta.
 */
export async function listarListasDePrecios(companyId: string): Promise<ListaDePrecios[]> {
  const { data, error } = await supabase
    .from('price_lists')
    .select('id, name, currency_code, is_default')
    .eq('company_id', companyId)
    .order('name')

  if (error) throw new Error(`No se pudieron leer las listas de precios: ${error.message}`)
  return (data ?? []).map((l) => ({
    id: l.id,
    nombre: l.name,
    moneda: l.currency_code,
    esPorDefecto: l.is_default,
  }))
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
import type { Facetas } from '../types'

/** Forma cruda que devuelve `public.catalog_facets`. */
interface RespuestaFacetas {
  total: number
  brands: { id: string; name: string; count: number }[]
  categories: { id: string; slug: string; name: string; count: number }[]
  product_types: { value: string; count: number }[]
  attributes: Record<
    string,
    { label: string; unit: string | null; values: { value: string; count: number }[] }
  >
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
    p_attrs: plan.atributos,
    p_ranges: plan.rangos,
  })

  if (error) throw new Error(`No se pudieron leer los filtros: ${error.message}`)

  const r = (data ?? {
    total: 0, brands: [], categories: [], product_types: [], attributes: {},
  }) as RespuestaFacetas

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
    atributos: Object.entries(r.attributes ?? {}).map(([key, a]) =>
      clasificarFaceta(key, a.label, a.unit, a.values),
    ),
  }
}
