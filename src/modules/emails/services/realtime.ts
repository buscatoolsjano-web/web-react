import { REALTIME_SUBSCRIBE_STATES, type RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase/client'
import type { Database } from '@/types/database.types'

/**
 * Realtime de la bandeja: tres tablas y nada más.
 *
 * `postgres_changes` evalúa la RLS de cada suscriptor con su JWT. Un vendedor
 * que abriera este canal recibiría cero eventos: el filtro por empresa de acá
 * acota el tráfico, no autoriza.
 *
 * Sin polling: si el canal se cae, la UI lo muestra y ofrece reconectar.
 */

type Tablas = Database['public']['Tables']
export type CambioHilo = RealtimePostgresChangesPayload<Tablas['email_threads']['Row']>
export type CambioEstado = RealtimePostgresChangesPayload<Tablas['email_thread_state']['Row']>
export type CambioLectura = RealtimePostgresChangesPayload<Tablas['email_thread_reads']['Row']>

export type EstadoCanal = 'conectando' | 'conectado' | 'caido'

export interface OyentesBandeja {
  hilo: (c: CambioHilo) => void
  estado: (c: CambioEstado) => void
  lectura: (c: CambioLectura) => void
  canal: (e: EstadoCanal) => void
}

export function suscribirBandeja(companyId: string, userId: string, oyentes: OyentesBandeja): () => void {
  // Al cancelar llega un CLOSED del canal viejo: no tiene que pisar el estado
  // del canal nuevo.
  let activo = true
  oyentes.canal('conectando')
  const canal = supabase
    .channel(`emails:${companyId}:${userId}:${Date.now()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'email_threads', filter: `company_id=eq.${companyId}` },
      oyentes.hilo,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'email_thread_state', filter: `company_id=eq.${companyId}` },
      oyentes.estado,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'email_thread_reads', filter: `user_id=eq.${userId}` },
      oyentes.lectura,
    )
    .subscribe((estado) => {
      if (!activo) return
      if (estado === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) oyentes.canal('conectado')
      else oyentes.canal('caido')
    })
  return () => {
    activo = false
    void supabase.removeChannel(canal)
  }
}
