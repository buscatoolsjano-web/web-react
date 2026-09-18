import { supabase } from '@/services/supabase/client'
import type { EventoDeCliente } from '../types'

/**
 * La trazabilidad del cliente (Fase 17 · E4).
 *
 * Lee `sales_audit`, la misma tabla genérica que usa Ventas: `entity_type`
 * vale `customer` y `entity_id` es el cliente. Los eventos ya los venían
 * escribiendo E1 (alta, edición, baja y reactivación) y E3 (contactos y
 * direcciones); E4 agregó los adjuntos y no inventó ninguno más.
 *
 * **No se audita leer.** Abrir la ficha, descargar un adjunto o mirar los
 * precios no deja rastro: un registro de lecturas sería un registro de
 * vigilancia, y además ahogaría los cambios, que es lo que hay que poder ver.
 *
 * El nombre del actor viaja en la MISMA consulta, con el join embebido de
 * PostgREST: una consulta, no una por evento.
 */
export async function eventosDeCliente(
  companyId: string,
  clienteId: string,
  opciones: { limite?: number; desplazamiento?: number } = {},
): Promise<{ eventos: EventoDeCliente[]; hayMas: boolean }> {
  const limite = opciones.limite ?? 25
  const desde = opciones.desplazamiento ?? 0

  const { data, error } = await supabase
    .from('sales_audit')
    .select(
      `id, action, from_status, to_status, diff, created_at,
       actor:profiles!actor_id ( full_name )`,
    )
    .eq('company_id', companyId)
    .eq('entity_type', 'customer')
    .eq('entity_id', clienteId)
    .order('created_at', { ascending: false })
    // Se pide uno de más para saber si hay página siguiente sin contar todo.
    .range(desde, desde + limite)
  if (error) throw new Error(`No se pudo leer la trazabilidad: ${error.message}`)

  const filas = (data ?? []) as unknown as {
    id: string
    action: string
    from_status: string | null
    to_status: string | null
    diff: unknown
    created_at: string
    actor: { full_name: string | null } | null
  }[]

  const hayMas = filas.length > limite
  return {
    eventos: filas.slice(0, limite).map((f) => ({
      id: f.id,
      accion: f.action,
      desde: f.from_status,
      hasta: f.to_status,
      diff: (f.diff ?? null) as EventoDeCliente['diff'],
      cuando: f.created_at,
      quien: f.actor?.full_name ?? null,
    })),
    hayMas,
  }
}
