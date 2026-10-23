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

// ── Portadas de categoría (Fase 143) ───────────────────────────────────────

export interface CategoriaPortada {
  categoryId: string
  nombre: string
  portadaProductId: string | null
  portadaUrl: string | null
  /** Cuántos productos de la categoría tienen foto (0 = no se puede elegir). */
  conFotos: number
}

export interface ProductoConFoto {
  id: string
  sku: string
  nombre: string
  fotoUrl: string | null
}

/** Las categorías con su portada actual y si hay fotos para elegir. */
export async function portadasDeCategorias(companyId: string): Promise<CategoriaPortada[]> {
  const { data, error } = await supabase.rpc('web_portadas_categorias' as never, { p_company: companyId } as never)
  if (error) throw new Error(`No se pudieron leer las portadas: ${error.message}`)
  const filas = (data ?? []) as unknown as {
    category_id: string; nombre: string; portada_product_id: string | null
    portada_url: string | null; con_fotos: number | string
  }[]
  return filas.map((f) => ({
    categoryId: f.category_id,
    nombre: f.nombre,
    portadaProductId: f.portada_product_id,
    portadaUrl: f.portada_url,
    conFotos: Number(f.con_fotos),
  }))
}

/** Los productos de una categoría que tienen foto, para elegir la portada. */
export async function productosConFotoDeCategoria(
  companyId: string,
  categoriaId: string,
  texto: string,
): Promise<ProductoConFoto[]> {
  const { data, error } = await supabase.rpc('web_portada_productos' as never, {
    p_company: companyId,
    p_categoria: categoriaId,
    p_texto: texto.trim() === '' ? null : texto.trim(),
  } as never)
  if (error) throw new Error(`No se pudieron buscar los productos: ${error.message}`)
  const filas = (data ?? []) as unknown as { id: string; sku: string; nombre: string; foto_url: string | null }[]
  return filas.map((p) => ({ id: p.id, sku: p.sku, nombre: p.nombre, fotoUrl: p.foto_url }))
}

/** Fija (o limpia, con `productoId` null) la portada de una categoría. */
export async function fijarPortadaCategoria(
  companyId: string,
  categoriaId: string,
  productoId: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('web_portada_fijar' as never, {
    p_company: companyId,
    p_categoria: categoriaId,
    p_producto: productoId,
  } as never)
  if (error) throw new Error(`No se pudo fijar la portada: ${error.message}`)
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
