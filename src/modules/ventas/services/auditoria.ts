import { supabase } from '@/services/supabase/client'

export type EntidadAuditable = 'sales_quote' | 'sales_order' | 'delivery'

export type AccionAuditable =
  | 'created'
  | 'updated_sensitive_fields'
  | 'sent'
  | 'approved'
  | 'rejected'
  | 'cancelled'

export type Diff = Record<string, { from: string | number | null; to: string | number | null }>

/**
 * Auditoría de Ventas.
 *
 * `sales_audit` no tiene policy de INSERT: la única puerta es la función
 * `registrar_evento_venta`, que es `SECURITY DEFINER`, valida la acción
 * contra una lista cerrada y saca la empresa DEL DOCUMENTO, no de lo que
 * mande el cliente.
 *
 * Se llama por ACCIÓN DE NEGOCIO. No por tecla, no por autosave, no por un
 * UPDATE técnico: el legacy llegó a 984 MB registrando cada UPDATE.
 */
export async function registrarEvento(
  tipo: EntidadAuditable,
  id: string,
  accion: AccionAuditable,
  desde: string | null,
  hasta: string | null,
  diff: Diff | null,
): Promise<void> {
  const { error } = await supabase.rpc('registrar_evento_venta', {
    p_entity_type: tipo,
    p_entity_id: id,
    p_action: accion,
    ...(desde !== null && { p_from_status: desde }),
    ...(hasta !== null && { p_to_status: hasta }),
    ...(diff !== null && { p_diff: diff }),
  })
  // Un fallo de auditoría no puede tumbar la operación de negocio que ya se
  // hizo, pero tampoco se traga en silencio.
  if (error) console.error('No se pudo registrar el evento de auditoría:', error.message)
}

/**
 * Campos cuyo cambio, en un documento ya comprometido, se audita.
 *
 * Los cuatro son el precio: lo que cambia cuánto paga el cliente. Cambiar un
 * título o una nota no es un hecho comercial.
 */
const SENSIBLES = new Set([
  'unit_price',
  'quantity',
  'quantity_ordered',
  'discount_pct',
  'perception_pct',
])

export function esSensible(campo: string): boolean {
  return SENSIBLES.has(campo)
}

/** Qué se puede hacer con un documento según su estado. */
export interface Editabilidad {
  editable: boolean
  /** Motivo por el que NO se puede editar, o advertencia cuando sí se puede. */
  motivo: string | null
  /** `true` cuando editar deja rastro en `sales_audit`. */
  audita: boolean
}
