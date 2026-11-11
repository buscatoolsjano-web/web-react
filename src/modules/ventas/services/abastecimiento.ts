import { supabase } from '@/services/supabase/client'

/**
 * El abastecimiento de una venta (Fase 237): qué se vendió, qué se pidió a
 * proveedores PARA ESTA VENTA, el stock y lo que falta, con cada compra y su
 * llegada estimada. Lo arma `abastecimiento_de_venta()` en la base, con la RLS
 * de quien pregunta.
 */
export interface CompraDeLinea {
  pedidoId: string
  numero: string
  /** draft | confirmed | cancelled */
  estado: string
  /** pending | partially_received | received */
  estadoRecepcion: string
  llegadaEstimada: string | null
  /** La cantidad de la línea de compra entera. */
  cantidad: number
  /** La parte de esa compra que es para esta venta. */
  paraVenta: number
  /** Lo ya recibido de esa línea de compra (recepciones confirmadas). */
  recibido: number
}

export interface LineaAbastecimiento {
  lineaId: string
  lineaNo: number
  productoId: string | null
  sku: string | null
  nombre: string | null
  vendido: number
  /** Lo pedido a proveedores PARA esta venta, sumando todas sus compras. */
  pedidoParaVenta: number
  stockDisponible: number
  compras: CompraDeLinea[]
}

const n = (v: unknown): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export async function abastecimientoDeVenta(
  tipo: 'cotizacion' | 'pedido',
  id: string,
): Promise<LineaAbastecimiento[]> {
  const { data, error } = await supabase.rpc('abastecimiento_de_venta', { p_tipo: tipo, p_id: id })
  if (error) throw new Error(`No se pudo leer qué se compró para esta venta: ${error.message}`)
  const filas = (Array.isArray(data) ? data : []) as Record<string, unknown>[]
  return filas.map((f) => ({
    lineaId: String(f.linea_id),
    lineaNo: n(f.linea_no),
    productoId: (f.producto_id as string | null) ?? null,
    sku: (f.sku as string | null) ?? null,
    nombre: (f.nombre as string | null) ?? null,
    vendido: n(f.vendido),
    pedidoParaVenta: n(f.pedido_para_venta),
    stockDisponible: n(f.stock_disponible),
    compras: ((f.compras as Record<string, unknown>[] | null) ?? []).map((c) => ({
      pedidoId: String(c.pedido_id),
      numero: String(c.numero),
      estado: String(c.estado),
      estadoRecepcion: String(c.estado_recepcion),
      llegadaEstimada: (c.llegada_estimada as string | null) ?? null,
      cantidad: n(c.cantidad),
      paraVenta: n(c.para_venta),
      recibido: n(c.recibido),
    })),
  }))
}
