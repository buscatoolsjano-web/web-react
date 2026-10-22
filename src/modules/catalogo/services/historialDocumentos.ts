import { supabase } from '@/services/supabase/client'

/**
 * El histórico comercial de un producto (Fase 113): las cotizaciones, pedidos y
 * notas de entrega donde aparece. Lo resuelve la RPC
 * `producto_historial_documentos`, que corre con la RLS de quien pregunta.
 */
export type TipoDocHistorial = 'cotizacion' | 'pedido' | 'entrega'

export interface DocumentoHistorial {
  tipo: TipoDocHistorial
  docId: string
  numero: string
  fecha: string | null
  cliente: string | null
  moneda: string | null
  cantidad: number
  precioUnitario: number | null
  estado: string | null
}

interface FilaRpc {
  tipo: string
  doc_id: string
  numero: string
  fecha: string | null
  cliente: string | null
  moneda: string | null
  cantidad: number | string | null
  precio_unitario: number | string | null
  estado: string | null
}

export async function historialDocumentosDeProducto(productId: string): Promise<DocumentoHistorial[]> {
  // La RPC es nueva y no está en database.types.ts (no se regenera, ver memoria);
  // se castea acá nomás en vez de tocar el archivo de tipos global.
  const { data, error } = await supabase.rpc(
    'producto_historial_documentos' as never,
    { p_product: productId } as never,
  )
  if (error) throw new Error(`No se pudo leer el historial del producto: ${error.message}`)
  const filas: FilaRpc[] = data ?? []
  return filas.map((r) => ({
    tipo: r.tipo === 'pedido' || r.tipo === 'entrega' ? r.tipo : 'cotizacion',
    docId: r.doc_id,
    numero: r.numero,
    fecha: r.fecha,
    cliente: r.cliente,
    moneda: r.moneda,
    cantidad: Number(r.cantidad ?? 0),
    precioUnitario: r.precio_unitario === null ? null : Number(r.precio_unitario),
    estado: r.estado,
  }))
}
