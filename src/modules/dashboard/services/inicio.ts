import { supabase } from '@/services/supabase/client'
import type { Json } from '@/types/database.types'

/**
 * La disposición del inicio, en `profiles.inicio` (Fase 76).
 *
 * Calcado de la apariencia: se LEE la fila propia con la RLS de siempre y se
 * ESCRIBE sólo por la RPC `guardar_mi_inicio`, que toma el usuario del JWT.
 * Un usuario no tiene UPDATE sobre `profiles`, así que no hay forma de
 * acomodarle el inicio a otro ni por error.
 *
 * Acá no se valida nada: lo que vuelve lo normaliza `lib/widgets`, que es puro
 * y está probado. Una pantalla que se defiende de los datos en dos lugares
 * termina defendiéndose distinto en cada uno.
 */
export async function leerInicio(userId: string): Promise<unknown> {
  const { data, error } = await supabase.from('profiles').select('inicio').eq('id', userId).maybeSingle()
  if (error) throw new Error(`No se pudo leer tu inicio: ${error.message}`)
  return data?.inicio ?? null
}

/** `null` restaura el que viene de fábrica. */
export async function guardarInicio(valor: unknown): Promise<unknown> {
  const { data, error } = await supabase.rpc('guardar_mi_inicio', {
    p_inicio: (valor ?? null) as Json,
  })
  if (error) throw new Error(`No se pudo guardar tu inicio: ${error.message}`)
  return data ?? null
}
