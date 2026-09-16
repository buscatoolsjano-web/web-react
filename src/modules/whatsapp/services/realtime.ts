import { REALTIME_SUBSCRIBE_STATES, type RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase/client'
import type { Database } from '@/types/database.types'

/**
 * Realtime de WhatsApp. Dos tablas y nada más.
 *
 * El sistema anterior consultaba cada dos segundos, para todos los usuarios,
 * todo el día. Acá no hay ni un `setInterval`: la bandeja se refresca cuando
 * la base avisa.
 *
 * `postgres_changes` evalúa la RLS de cada suscriptor con SU JWT, así que un
 * vendedor sólo recibe eventos de lo que tiene asignado. El filtro por empresa
 * de acá **acota el tráfico, no autoriza**: confundir esas dos cosas ya nos
 * costó un hallazgo de seguridad.
 *
 * `whatsapp_media` también está publicada, pero la bandeja no se suscribe: un
 * adjunto que termina de bajarse no justifica un evento por fila para todos.
 * El mensaje que lo contiene ya disparó el suyo.
 */

type Tablas = Database['public']['Tables']
export type CambioMensaje = RealtimePostgresChangesPayload<Tablas['whatsapp_messages']['Row']>
export type CambioConversacion = RealtimePostgresChangesPayload<Tablas['whatsapp_conversations']['Row']>

export type EstadoCanal = 'conectando' | 'conectado' | 'caido'

export interface OyentesWhatsapp {
  mensaje: (c: CambioMensaje) => void
  conversacion: (c: CambioConversacion) => void
  canal: (e: EstadoCanal) => void
}

export function suscribirWhatsapp(companyId: string, oyentes: OyentesWhatsapp): () => void {
  // Al cancelar llega un CLOSED del canal viejo: no tiene que pisar el estado
  // del canal nuevo.
  let activo = true
  oyentes.canal('conectando')

  const canal = supabase
    .channel(`whatsapp:${companyId}:${Date.now()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'whatsapp_messages', filter: `company_id=eq.${companyId}` },
      oyentes.mensaje,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'whatsapp_conversations', filter: `company_id=eq.${companyId}` },
      oyentes.conversacion,
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
