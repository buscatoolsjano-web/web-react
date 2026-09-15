import { supabase } from '@/services/supabase/client'
import { normalizarApariencia, type Apariencia } from '@/features/apariencia/opciones'

/**
 * Apariencia guardada en `profiles.appearance`, la fila del propio usuario.
 *
 * El aislamiento lo da RLS (`profiles_update_own`: id = auth.uid()) y la
 * validación, el CHECK `profiles_appearance_valida`. El `eq('id', userId)`
 * sólo elige la fila: con el id de otra persona el UPDATE toca 0 filas.
 */
export async function leerApariencia(userId: string): Promise<Apariencia> {
  const { data, error } = await supabase.from('profiles').select('appearance').eq('id', userId).maybeSingle()
  if (error) throw new Error(`No se pudo leer la apariencia: ${error.message}`)
  return normalizarApariencia(data?.appearance ?? null)
}

export async function guardarApariencia(userId: string, a: Apariencia | null): Promise<void> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ appearance: a === null ? null : { ...a } })
    .eq('id', userId)
    .select('id')
  if (error) throw new Error(`No se pudo guardar la apariencia: ${error.message}`)
  if (!data || data.length === 0) throw new Error('No se pudo guardar la apariencia: el perfil no existe o no es tuyo.')
}
