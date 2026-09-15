import { supabase } from '@/services/supabase/client'
import { normalizarApariencia, type Apariencia } from '@/features/apariencia/opciones'

/**
 * Apariencia guardada en `profiles.appearance`.
 *
 * Leer: la fila propia (RLS `profiles_select`).
 * Guardar: SÓLO por la RPC `guardar_mi_apariencia`, que escribe la columna
 * `appearance` de la fila de `auth.uid()` y nada más. Un usuario no tiene
 * privilegio de UPDATE sobre `profiles` (ver
 * docs/database/PHASE_14_ENTREGA_0_PROFILES_ESCRITURA.sql). El valor lo valida
 * el CHECK `profiles_appearance_valida`.
 */
export async function leerApariencia(userId: string): Promise<Apariencia> {
  const { data, error } = await supabase.from('profiles').select('appearance').eq('id', userId).maybeSingle()
  if (error) throw new Error(`No se pudo leer la apariencia: ${error.message}`)
  return normalizarApariencia(data?.appearance ?? null)
}

/** `null` = restaurar el original. Nunca se manda el perfil ni un id: la base toma el usuario del JWT. */
export async function guardarApariencia(a: Apariencia | null): Promise<void> {
  const { error } = await supabase.rpc('guardar_mi_apariencia', { p_appearance: a === null ? null : { ...a } })
  if (error) throw new Error(`No se pudo guardar la apariencia: ${error.message}`)
}
