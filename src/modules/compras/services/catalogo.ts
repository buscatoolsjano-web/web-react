import { supabase } from '@/services/supabase/client'
import type { UltimoPrecioCompra } from '../types'

/**
 * Lo que hace falta del catálogo y de los proveedores para armar una línea.
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
 * **No devuelve ningún precio.** En Ventas el selector sugiere el precio de
 * la lista por defecto; acá eso sería un error grave: `price_lists` son las
 * listas de VENTA —Lista base, Distribuidores, Especial Cliente Demo— y en un
 * pedido de compra el precio es lo que se le PAGA al proveedor. Sugerirlo
 * sería confundir lo que se cobra con lo que se paga.
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
export async function ultimosPreciosDeCompra(
  companyId: string,
  productIds: readonly string[],
  moneda: string,
  proveedorId: string | null = null,
): Promise<Map<string, UltimoPrecioCompra>> {
  const ids = [...new Set(productIds)].filter((x) => x !== '')
  if (ids.length === 0 || moneda === '') return new Map()

  const { data, error } = await supabase.rpc('ultimo_precio_compra', {
    p_company: companyId,
    p_products: ids,
    p_currency: moneda,
    p_supplier: proveedorId,
  })
  if (error) throw new Error(`No se pudo leer el último precio de compra: ${error.message}`)

  const salida = new Map<string, UltimoPrecioCompra>()
  for (const f of (data ?? []) as unknown as {
    product_id: string
    unit_price: number | string
    discount_pct: number | string
    order_number: string
    order_date: string
    supplier_name: string
  }[]) {
    salida.set(f.product_id, {
      productId: f.product_id,
      precio: Number(f.unit_price),
      descuentoPct: Number(f.discount_pct),
      numero: f.order_number,
      fecha: f.order_date,
      proveedor: f.supplier_name,
    })
  }
  return salida
}

export interface ProveedorBuscado {
  id: string
  referencia: string | null
  razonSocial: string
  nombreComercial: string | null
  formaPago: string | null
  moneda: string | null
  /** Días habituales de entrega (2026-11): proponen la llegada estimada. */
  diasEntrega?: number | null
}

/**
 * Buscador de proveedores para la cabecera.
 *
 * Excluye a los dados de baja y a los inactivos: un proveedor dado de baja no
 * se ofrece al armar un pedido nuevo, que es justamente para lo que sirve la
 * baja lógica. Los pedidos viejos lo siguen nombrando igual.
 *
 * Sin texto devuelve los primeros por orden alfabético, así el selector sirve
 * también para mirar la lista.
 */
export async function buscarProveedores(
  companyId: string,
  texto: string,
  limite = 20,
): Promise<ProveedorBuscado[]> {
  let q = supabase
    .from('suppliers')
    .select('id, legacy_ref, legal_name, trade_name, payment_terms, default_currency, lead_time_days')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .eq('status', 'active')

  const limpio = texto.trim().replace(/[,()*]/g, '')
  if (limpio !== '') {
    const patron = `%${limpio}%`
    q = q.or(
      [
        `legal_name.ilike.${patron}`,
        `trade_name.ilike.${patron}`,
        `legacy_ref.ilike.${patron}`,
      ].join(','),
    )
  }

  const { data, error } = await q.order('legal_name', { ascending: true }).limit(limite)
  if (error) throw new Error(`No se pudieron buscar proveedores: ${error.message}`)

  return (data ?? []).map((p) => ({
    id: p.id,
    referencia: p.legacy_ref,
    razonSocial: p.legal_name,
    nombreComercial: p.trade_name,
    formaPago: p.payment_terms,
    moneda: p.default_currency,
    diasEntrega: p.lead_time_days,
  }))
}

/** Un proveedor puntual, para mostrar el elegido sin volver a buscarlo. */
export async function obtenerProveedorBreve(
  companyId: string,
  id: string,
): Promise<ProveedorBuscado | null> {
  const { data, error } = await supabase
    .from('suppliers')
    .select('id, legacy_ref, legal_name, trade_name, payment_terms, default_currency, lead_time_days')
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el proveedor: ${error.message}`)
  if (!data) return null
  return {
    id: data.id,
    referencia: data.legacy_ref,
    razonSocial: data.legal_name,
    nombreComercial: data.trade_name,
    formaPago: data.payment_terms,
    moneda: data.default_currency,
    diasEntrega: data.lead_time_days,
  }
}

/**
 * El costo cargado en cada producto (`products.cost_amount` y su moneda).
 *
 * Lo cargan las altas del ERP y la importación de facturas de compra. Sirve
 * para que una línea de compra no nazca en 0 cuando se sabe cuánto cuesta.
 */
export async function costosDeProductos(
  companyId: string,
  productIds: readonly string[],
): Promise<Map<string, { monto: number; moneda: string | null }>> {
  const ids = [...new Set(productIds)].filter((x) => x !== '')
  const salida = new Map<string, { monto: number; moneda: string | null }>()
  if (ids.length === 0) return salida
  const { data, error } = await supabase
    .from('products')
    .select('id, cost_amount, cost_currency')
    .eq('company_id', companyId)
    .in('id', ids)
  if (error) throw new Error(`No se pudo leer el costo de los productos: ${error.message}`)
  for (const f of (data ?? []) as { id: string; cost_amount: number | string | null; cost_currency: string | null }[]) {
    const monto = Number(f.cost_amount)
    if (f.cost_amount !== null && Number.isFinite(monto) && monto > 0) salida.set(f.id, { monto, moneda: f.cost_currency })
  }
  return salida
}
