import { supabase } from '@/services/supabase/client'

/**
 * Gestor de visibilidad del sitio público (Fase 116). Lo que se muestra en la
 * web se controla por `products.public_slug` (no nulo = visible). Las RPCs
 * `web_visibilidad_*` dan el resumen por categoría y aplican el cambio en masa
 * del lado del servidor (no miles de updates por red).
 */
export interface CategoriaVisibilidad {
  categoryId: string
  nombre: string
  total: number
  visibles: number
}

export interface ProductoVisibilidad {
  id: string
  sku: string
  nombre: string
  visible: boolean
}

interface FilaCat {
  category_id: string
  nombre: string
  total: number | string
  visibles: number | string
}

export async function visibilidadCategorias(companyId: string): Promise<CategoriaVisibilidad[]> {
  const { data, error } = await supabase.rpc('web_visibilidad_categorias' as never, { p_company: companyId } as never)
  if (error) throw new Error(`No se pudo leer la visibilidad: ${error.message}`)
  const filas: FilaCat[] = data ?? []
  return filas.map((f) => ({
    categoryId: f.category_id,
    nombre: f.nombre,
    total: Number(f.total),
    visibles: Number(f.visibles),
  }))
}

/** Muestra u oculta una categoría entera o un producto puntual. Devuelve cuántos cambió. */
export async function aplicarVisibilidad(
  companyId: string,
  visible: boolean,
  alcance: { categoryId?: string | undefined; productId?: string | undefined },
): Promise<number> {
  const { data, error } = await supabase.rpc('web_visibilidad_aplicar' as never, {
    p_company: companyId,
    p_visible: visible,
    p_category: alcance.categoryId ?? null,
    p_product: alcance.productId ?? null,
  } as never)
  if (error) throw new Error(`No se pudo aplicar el cambio: ${error.message}`)
  return Number(data ?? 0)
}

/** Busca productos por referencia o nombre para tildarlos de a uno. */
export async function buscarProductosVisibilidad(companyId: string, texto: string): Promise<ProductoVisibilidad[]> {
  const q = texto.trim()
  if (q.length < 2) return []
  // Las comas y paréntesis rompen el `or()` de PostgREST: se sacan.
  const limpio = q.replace(/[,()%\\]/g, ' ').trim()
  if (limpio === '') return []
  const { data, error } = await supabase
    .from('products')
    // `public_slug` no está en database.types.ts (no se regenera, ver memoria):
    // se castea la columna para que el validador de tipos no la rechace.
    .select('id, sku, name, public_slug' as never)
    .eq('company_id', companyId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .or(`sku.ilike.%${limpio}%,name.ilike.%${limpio}%`)
    .order('sku')
    .limit(40)
  if (error) throw new Error(`No se pudieron buscar los productos: ${error.message}`)
  const filas = (data ?? []) as unknown as { id: string; sku: string; name: string; public_slug: string | null }[]
  return filas.map((p) => ({ id: p.id, sku: p.sku, nombre: p.name, visible: p.public_slug !== null }))
}
