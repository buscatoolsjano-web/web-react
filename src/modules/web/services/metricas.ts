import { supabase } from '@/services/supabase/client'

/**
 * Métricas del sitio público para el panel de Web (Fase 115). Las resuelve la
 * RPC `web_metricas`, que agrega visitas, visitantes, consultas y series por
 * día para la empresa activa.
 */
export interface PorDia {
  dia: string
  visitas: number
  consultas: number
}
export interface TopPath {
  path: string
  visitas: number
}
export interface ProductoPedido {
  sku: string | null
  nombre: string | null
  veces: number
}
export interface MetricasWeb {
  visitas: number
  visitantes: number
  consultas: number
  consultasPendientes: number
  porDia: PorDia[]
  topPaths: TopPath[]
  productosMasPedidos: ProductoPedido[]
}

interface Cruda {
  visitas?: number
  visitantes?: number
  consultas?: number
  consultas_pendientes?: number
  por_dia?: PorDia[]
  top_paths?: TopPath[]
  productos_mas_pedidos?: ProductoPedido[]
}

export async function metricasWeb(companyId: string, desde: string, hasta: string): Promise<MetricasWeb> {
  // La RPC es nueva y no está en database.types.ts (no se regenera, ver memoria).
  const { data, error } = await supabase.rpc(
    'web_metricas' as never,
    { p_company: companyId, p_desde: desde, p_hasta: hasta } as never,
  )
  if (error) throw new Error(`No se pudieron leer las métricas de la web: ${error.message}`)
  const c: Cruda = data ?? {}
  return {
    visitas: c.visitas ?? 0,
    visitantes: c.visitantes ?? 0,
    consultas: c.consultas ?? 0,
    consultasPendientes: c.consultas_pendientes ?? 0,
    porDia: c.por_dia ?? [],
    topPaths: c.top_paths ?? [],
    productosMasPedidos: c.productos_mas_pedidos ?? [],
  }
}
