import { supabase } from '@/services/supabase/client'

export interface SaludAltaProductos {
  attempts24h: number
  succeeded24h: number
  failed24h: number
  pending: number
  lastAttemptAt: string | null
}

export async function saludAltaProductos(companyId: string): Promise<SaludAltaProductos> {
  const { data, error } = await supabase
    .from('product_creation_health')
    .select('attempts_24h,succeeded_24h,failed_24h,pending,last_attempt_at')
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw error
  return {
    attempts24h: Number(data?.attempts_24h ?? 0),
    succeeded24h: Number(data?.succeeded_24h ?? 0),
    failed24h: Number(data?.failed_24h ?? 0),
    pending: Number(data?.pending ?? 0),
    lastAttemptAt: data?.last_attempt_at ?? null,
  }
}
