import { supabase } from '@/services/supabase/client'
import type { EventoDeProveedor } from '../types'

/** Las entidades de Compras que dejan rastro en `purchases_audit`. */
export type EntidadAuditada =
  | 'supplier'
  | 'purchase_order'
  | 'goods_receipt'
  | 'supplier_invoice'

/**
 * El historial de un documento de Compras: `purchases_audit`.
 *
 * La tabla es de sólo lectura desde PostgREST —su única policy es SELECT— y
 * se escribe desde triggers y desde `registrar_evento_compra`. Guarda
 * **acciones de negocio**: alta, confirmación, anulación. Las ediciones de un
 * borrador no se auditan; auditar cada UPDATE técnico llenaría la tabla de
 * ruido y taparía lo que importa.
 */
export async function historialDeEntidad(
  companyId: string,
  entidad: EntidadAuditada,
  entidadId: string,
  tope = 100,
): Promise<EventoDeProveedor[]> {
  const { data, error } = await supabase
    .from('purchases_audit')
    .select('id, action, from_status, to_status, diff, created_at, actor:profiles!actor_id ( full_name )')
    .eq('company_id', companyId)
    .eq('entity_type', entidad)
    .eq('entity_id', entidadId)
    .order('created_at', { ascending: false })
    .limit(tope)
  if (error) throw new Error(`No se pudo leer el historial: ${error.message}`)

  return ((data ?? []) as unknown as {
    id: number
    action: string
    from_status: string | null
    to_status: string | null
    diff: Record<string, unknown> | null
    created_at: string
    actor: { full_name: string | null } | null
  }[]).map((e) => ({
    id: e.id,
    accion: e.action,
    estadoAnterior: e.from_status,
    estadoNuevo: e.to_status,
    autor: e.actor?.full_name ?? null,
    fecha: e.created_at,
    diff: e.diff,
  }))
}
