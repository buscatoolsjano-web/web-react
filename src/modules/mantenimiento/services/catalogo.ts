import { supabase } from '@/services/supabase/client'

/**
 * Lo que hace falta del catálogo y de los clientes para cargar un equipo.
 *
 * Nada se trae entero: el legacy tenía `PRODUCTOS`, un array global con los
 * 21.775 productos, y filtraba en memoria. Acá cada búsqueda —debounceada—
 * pide como mucho 20 filas.
 */

export interface ProductoBuscado {
  id: string
  sku: string
  nombre: string
  marca: string | null
}

/**
 * Búsqueda de productos por SKU, nombre o marca.
 *
 * Va contra `search_products`, la misma RPC del Catálogo.
 *
 * **No devuelve ningún precio.** Acá el producto identifica QUÉ herramienta es
 * el equipo; lo que cueste no tiene nada que ver.
 */
export async function buscarProductos(
  companyId: string,
  texto: string,
  limite = 20,
): Promise<ProductoBuscado[]> {
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

  const { data: filas, error: eP } = await supabase
    .from('products')
    .select('id, sku, name, brands!brand_id ( name )')
    .eq('company_id', companyId)
    .in('id', ids)
  if (eP) throw new Error(`No se pudieron leer los productos: ${eP.message}`)

  const porId = new Map(
    ((filas ?? []) as unknown as {
      id: string
      sku: string
      name: string
      brands: { name: string } | null
    }[]).map((p) => [p.id, p]),
  )

  // Se respeta el orden del ranking: la RPC ya ordenó por relevancia.
  return ids.flatMap((id) => {
    const p = porId.get(id)
    return p ? [{ id: p.id, sku: p.sku, nombre: p.name, marca: p.brands?.name ?? null }] : []
  })
}

/**
 * El último precio de compra de cada producto.
 *
 * **No hay ninguna fuente de costo en la base.** Se auditó: `price_lists` son
 * las tres listas de venta, `products` no tiene columna de costo y no existe
 * ninguna tabla de precios de proveedor. Así que el precio de compra se
 * escribe a mano, como corresponde.
 *
 * Lo único que se ofrece es un dato REAL, derivado de documentos: cuánto se
 * pagó la última vez por ese producto, en esa moneda, en un pedido
 * **confirmado**. Nunca autocompleta: se muestra al lado del campo y la
 * persona decide.
 *
 * Si el producto no se compró nunca, no devuelve nada. Es lo que pasa hoy con
 * todos: no hay ningún pedido confirmado todavía.
 */

// ── Clientes ───────────────────────────────────────────────────────────────

export interface ClienteBuscado {
  id: string
  referencia: string | null
  razonSocial: string
  nombreComercial: string | null
}

/**
 * Búsqueda de clientes por razón social, nombre comercial, referencia o CUIT.
 *
 * Va por `public.buscar_clientes`, la MISMA de Ventas, para que el orden sea
 * el mismo en toda la app: primero los que empiezan con lo que se escribió,
 * después los que empiezan una palabra con eso, y recién al final los que lo
 * contienen en el medio (Fase 40).
 *
 * El orden lo decide la base y no esta función, y ésa es la diferencia que
 * importa: ordenar las 20 filas que ya llegaron no sirve de nada, porque con
 * 1.010 clientes la que se buscaba se perdió en el corte.
 */
export async function buscarClientes(
  companyId: string,
  texto: string,
  tope = 20,
): Promise<ClienteBuscado[]> {
  if (texto.trim().length < 2) return []

  const { data, error } = await supabase.rpc('buscar_clientes', {
    p_company: companyId,
    p_texto: texto,
    p_incluir_inactivos: false,
    p_limite: tope,
  })
  if (error) throw new Error(`No se pudieron buscar clientes: ${error.message}`)

  return (
    (data ?? []) as unknown as {
      id: string
      nombre: string | null
      razon_social: string | null
      referencia: string | null
    }[]
  ).map((c) => ({
    id: c.id,
    referencia: c.referencia,
    razonSocial: c.razon_social ?? c.nombre ?? 'Sin nombre',
    nombreComercial: c.nombre,
  }))
}

/** Un cliente por id, para mostrar el que ya está elegido. */
export async function obtenerClienteBreve(
  companyId: string,
  id: string,
): Promise<ClienteBuscado | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, legacy_ref, legal_name, trade_name')
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el cliente: ${error.message}`)
  if (!data) return null
  return {
    id: data.id,
    referencia: data.legacy_ref,
    razonSocial: data.legal_name,
    nombreComercial: data.trade_name,
  }
}

/** Un producto por id, para mostrar el que ya está elegido. */
export async function obtenerProductoBreve(
  companyId: string,
  id: string,
): Promise<ProductoBuscado | null> {
  const { data, error } = await supabase
    .from('products')
    .select('id, sku, name, brands!brand_id ( name )')
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el producto: ${error.message}`)
  if (!data) return null
  return { id: data.id, sku: data.sku, nombre: data.name, marca: data.brands?.name ?? null }
}
