import { supabase } from '@/services/supabase/client'

/**
 * «Pendiente de entregar» (Fase 238): lo vendido en pedidos de venta —desde
 * que se generan, aunque sigan en borrador— que falta entregar, acumulado por producto, con el stock, lo que viene en camino
 * de proveedores para esas ventas y lo que todavía falta pedir.
 */
export interface DocumentoPendienteEntrega {
  pedidoId: string
  numero: string
  fecha: string
  cliente: string | null
  /** Generado pero sin confirmar: igual cuenta como pendiente. */
  borrador: boolean
  pedido: number
  entregado: number
  pendiente: number
  enCamino: number
}

export interface ProductoPendienteEntrega {
  productoId: string
  sku: string | null
  nombre: string | null
  pedido: number
  entregado: number
  pendiente: number
  stock: number
  enCamino: number
  faltaPedir: number
  documentos: DocumentoPendienteEntrega[]
}

const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export async function pendienteDeEntregar(companyId: string, desde: string | null): Promise<ProductoPendienteEntrega[]> {
  const { data, error } = await supabase.rpc('pendiente_de_entregar', { p_company: companyId, p_desde: desde })
  if (error) throw new Error(`No se pudo leer lo pendiente de entregar: ${error.message}`)
  return ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map((f) => ({
    productoId: String(f.producto_id),
    sku: (f.sku as string | null) ?? null,
    nombre: (f.nombre as string | null) ?? null,
    pedido: n(f.pedido),
    entregado: n(f.entregado),
    pendiente: n(f.pendiente),
    stock: n(f.stock),
    enCamino: n(f.en_camino),
    faltaPedir: n(f.falta_pedir),
    documentos: ((f.documentos as Record<string, unknown>[] | null) ?? []).map((d) => ({
      pedidoId: String(d.pedido_id),
      numero: String(d.numero),
      fecha: String(d.fecha),
      cliente: (d.cliente as string | null) ?? null,
      borrador: d.borrador === true,
      pedido: n(d.pedido),
      entregado: n(d.entregado),
      pendiente: n(d.pendiente),
      enCamino: n(d.en_camino),
    })),
  }))
}
