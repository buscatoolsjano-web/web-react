import { supabase } from '@/services/supabase/client'

export interface ProductoParaLinea {
  id: string
  sku: string
  nombre: string
  marca: string | null
  /** Precio de la lista por defecto de la empresa, o `null` si no tiene. */
  precio: number | null
  monedaPrecio: string | null
}

/**
 * Búsqueda de productos para agregar una línea.
 *
 * Va contra la RPC `search_products`, la misma del Catálogo: busca por SKU,
 * nombre y marca del lado del servidor y devuelve como mucho `limite` filas.
 *
 * El legacy tenía los 21.775 productos en un array global (`PRODUCTOS`) y
 * filtraba con `.filter()` en memoria. Acá el navegador nunca recibe más de
 * lo que se muestra.
 */
export async function buscarProductos(
  companyId: string,
  texto: string,
  limite = 20,
): Promise<ProductoParaLinea[]> {
  const consulta = texto.trim()
  if (consulta.length < 2) return []

  const { data: ranking, error } = await supabase.rpc('search_products', {
    p_company: companyId,
    p_query: consulta,
    p_limit: limite,
    p_offset: 0,
    p_orden: 'nombre',
  })
  if (error) throw new Error(`No se pudieron buscar productos: ${error.message}`)

  const ids = (ranking ?? []).map((r) => r.id)
  if (ids.length === 0) return []

  // La lista por defecto de la empresa. Un precio de otra lista no se
  // sugiere: sería mostrar el precio de un cliente distinto.
  const { data: lista } = await supabase
    .from('price_lists')
    .select('id, currency_code')
    .eq('company_id', companyId)
    .eq('is_default', true)
    .maybeSingle()

  const { data: filas, error: eP } = await supabase
    .from('products')
    .select('id, sku, name, brands!brand_id ( name ), product_prices ( amount, price_list_id )')
    .eq('company_id', companyId)
    .in('id', ids)
  if (eP) throw new Error(`No se pudieron leer los productos: ${eP.message}`)

  const porId = new Map(
    ((filas ?? []) as unknown as {
      id: string
      sku: string
      name: string
      brands: { name: string } | null
      product_prices: { amount: number; price_list_id: string }[] | null
    }[]).map((p) => [p.id, p]),
  )

  // Se respeta el orden del ranking: la RPC ya ordenó por relevancia.
  return ids.flatMap((id) => {
    const p = porId.get(id)
    if (!p) return []
    const precio = lista
      ? (p.product_prices ?? []).find((x) => x.price_list_id === lista.id)?.amount ?? null
      : null
    return [{
      id: p.id,
      sku: p.sku,
      nombre: p.name,
      marca: p.brands?.name ?? null,
      precio: precio === null ? null : Number(precio),
      monedaPrecio: lista?.currency_code ?? null,
    }]
  })
}

/**
 * El precio a sugerir para una línea.
 *
 * Sólo se sugiere si la lista está en la MISMA moneda que el documento.
 * Convertir de USD a ARS sin un tipo de cambio confirmado sería inventar el
 * precio, y ya sabemos cómo termina eso: 104 documentos históricos quedaron
 * sin tipo de cambio porque el legacy no lo guardaba.
 */
export function precioSugerido(
  p: ProductoParaLinea,
  monedaDelDocumento: string,
): number | null {
  if (p.precio === null) return null
  if (p.monedaPrecio !== monedaDelDocumento) return null
  return p.precio
}
