import { supabase } from '@/services/supabase/client'
import type { ListaDelProducto } from '../lib/avisosDePrecio'

/**
 * Las listas del proveedor que traen este producto: la última versión de cada
 * una (costo y venta con su moneda) y la anterior, para ver si subió.
 * La RLS de las listas decide quién lo ve; un externo recibe una lista vacía.
 */
export async function listasDelProducto(companyId: string, productId: string): Promise<ListaDelProducto[]> {
  const { data, error } = await supabase.rpc('listas_del_producto', { p_company_id: companyId, p_product_id: productId })
  if (error) throw new Error(`No se pudieron leer las listas: ${error.message}`)
  const n = (x: number | null) => (x === null ? null : Number(x))
  return (data ?? []).map((f) => ({
    fuente: f.fuente,
    fecha: f.fecha,
    costo: n(f.costo),
    monedaCosto: f.moneda_costo,
    venta: n(f.venta),
    monedaVenta: f.moneda_venta,
    ancla: n(f.ancla),
    moneda: f.moneda,
    fechaAnterior: f.fecha_anterior,
    ventaAnterior: n(f.venta_anterior),
    anclaAnterior: n(f.ancla_anterior),
  }))
}
