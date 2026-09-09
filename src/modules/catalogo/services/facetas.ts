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
