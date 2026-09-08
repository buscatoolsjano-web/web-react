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
 * Atributos que se ofrecen como filtro para una categoría.
 *
 * LIMITACIÓN CONOCIDA: hoy devuelve todos los filtrables, sin importar la
 * categoría. `applies_to_category_id` está en NULL en las 26 filas y, según
 * la evidencia de docs/database/ATTRIBUTE_CATEGORY_RELATION.md, esa columna
 * no alcanza: 8 de los 11 atributos filtrables aplican a varias categorías,
 * y la jerarquía de categorías es plana. La relación correcta es N:N y está
 * propuesta, pendiente de aprobación.
 *
 * Cuando exista `product_attribute_categories`, se cambia SOLO esta función
 * y el resto del catálogo no se entera.
 */
export function filtrarAtributosDeCategoria(
  definiciones: readonly DefinicionAtributo[],
  _categoriaId: string | null,
): DefinicionAtributo[] {
  return definiciones.filter((d) => d.filtrable)
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
