import { REALTIME_SUBSCRIBE_STATES, type RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase/client'
import type { Database } from '@/types/database.types'

/**
 * Realtime del chat interno. Una tabla y nada más.
 *
 * `postgres_changes` evalúa la RLS de cada suscriptor con SU JWT, así que
 * nadie recibe eventos de una conversación en la que no está. El filtro por
 * empresa **acota el tráfico, no autoriza**: confundir esas dos cosas ya nos
 * costó un hallazgo de seguridad en WhatsApp.
 *
 * Sin `setInterval`: un chat que consulta cada dos segundos es el peor de los
 * dos mundos —lento para quien escribe y caro para la base—.
 */

type Tablas = Database['public']['Tables']
export type CambioMensajeChat = RealtimePostgresChangesPayload<Tablas['chat_mensajes']['Row']>

export type EstadoCanal = 'conectando' | 'conectado' | 'caido'

export interface OyentesChat {
  mensaje: (c: CambioMensajeChat) => void
  canal: (e: EstadoCanal) => void
}

export function suscribirChat(companyId: string, oyentes: OyentesChat): () => void {
  // Al cancelar llega un CLOSED del canal viejo: no tiene que pisar el estado
  // del canal nuevo.
  let activo = true
  oyentes.canal('conectando')

  const canal = supabase
    .channel(`chat:${companyId}:${Date.now()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_mensajes', filter: `company_id=eq.${companyId}` },
      oyentes.mensaje,
    )
    .subscribe((estado) => {
      if (!activo) return
      if (estado === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) oyentes.canal('conectado')
      else if (
        estado === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
        estado === REALTIME_SUBSCRIBE_STATES.TIMED_OUT ||
        estado === REALTIME_SUBSCRIBE_STATES.CLOSED
      ) {
        oyentes.canal('caido')
      }
    })

  return () => {
    activo = false
    void supabase.removeChannel(canal)
  }
}
