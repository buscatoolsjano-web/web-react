import { supabase } from '@/services/supabase/client'

/**
 * «Pendiente de recibir» (Fase 238): lo pedido a proveedores que todavía no
 * llegó —desde que el pedido se genera, aunque siga en borrador—, acumulado por producto, separando lo que es para ventas y
 * lo que es para stock, con la llegada estimada.
 */
export interface DocumentoPendienteRecepcion {
  pedidoId: string
  numero: string
  fecha: string
  proveedor: string | null
  llegadaEstimada: string | null
  /** Generado pero sin confirmar: igual cuenta como pendiente. */
  borrador: boolean
  pedido: number
  recibido: number
  pendiente: number
  paraVenta: number
  /** El número de la venta a la que va, si es para una venta. */
  venta: string | null
}

export interface ProductoPendienteRecepcion {
  productoId: string
  sku: string | null
  nombre: string | null
  pedido: number
  recibido: number
  pendiente: number
  paraVentas: number
  paraStock: number
  proximaLlegada: string | null
  atrasado: boolean
  documentos: DocumentoPendienteRecepcion[]
}

const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export async function pendienteDeRecibir(companyId: string, desde: string | null): Promise<ProductoPendienteRecepcion[]> {
  const { data, error } = await supabase.rpc('pendiente_de_recibir', { p_company: companyId, p_desde: desde })
  if (error) throw new Error(`No se pudo leer lo pendiente de recibir: ${error.message}`)
  return ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map((f) => ({
    productoId: String(f.producto_id),
    sku: (f.sku as string | null) ?? null,
    nombre: (f.nombre as string | null) ?? null,
    pedido: n(f.pedido),
    recibido: n(f.recibido),
    pendiente: n(f.pendiente),
    paraVentas: n(f.para_ventas),
    paraStock: n(f.para_stock),
    proximaLlegada: (f.proxima_llegada as string | null) ?? null,
    atrasado: f.atrasado === true,
    documentos: ((f.documentos as Record<string, unknown>[] | null) ?? []).map((d) => ({
      pedidoId: String(d.pedido_id),
      numero: String(d.numero),
      fecha: String(d.fecha),
      proveedor: (d.proveedor as string | null) ?? null,
      llegadaEstimada: (d.llegada_estimada as string | null) ?? null,
      borrador: d.borrador === true,
      pedido: n(d.pedido),
      recibido: n(d.recibido),
      pendiente: n(d.pendiente),
      paraVenta: n(d.para_venta),
      venta: (d.venta as string | null) ?? null,
    })),
  }))
}
