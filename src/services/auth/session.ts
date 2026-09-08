import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase/client'

/**
 * Capa de sesión. Es lo único que habla con supabase.auth.
 *
 * NO guardamos passwords, ni hashes, ni un "usuario logueado" propio en
 * localStorage. El SDK persiste el token bajo la clave `bt-auth` y lo
 * refresca solo. Ese fue el error central del legacy, donde la sesión era
 * una entrada de localStorage que cualquiera podía editar desde la consola.
 */

export interface ResultadoLogin {
  ok: boolean
  /** Mensaje ya traducido, listo para mostrar. */
  error?: string
}

/**
 * Traduce el error de Supabase a algo que le sirva a una persona.
 *
 * A propósito NO distinguimos "el email no existe" de "la contraseña está
 * mal": decirlo permite averiguar qué emails están registrados.
 */
export function traducirErrorAuth(mensaje: string): string {
  const m = mensaje.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Email o contraseña incorrectos.'
  if (m.includes('email not confirmed')) return 'Falta confirmar el email de esta cuenta.'
  if (m.includes('too many requests') || m.includes('rate limit'))
    return 'Demasiados intentos. Esperá unos minutos.'
  if (m.includes('failed to fetch') || m.includes('network'))
    return 'No se pudo contactar al servidor. Revisá la conexión.'
  return 'No se pudo iniciar sesión. Intentá de nuevo.'
}

export async function iniciarSesion(email: string, password: string): Promise<ResultadoLogin> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) return { ok: false, error: traducirErrorAuth(error.message) }
  return { ok: true }
}

export async function cerrarSesion(): Promise<void> {
  await supabase.auth.signOut()
}

export async function obtenerSesion(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session
}

/** Devuelve la función para desuscribirse. */
export function suscribirCambiosDeSesion(
  cb: (evento: AuthChangeEvent, sesion: Session | null) => void,
): () => void {
  const { data } = supabase.auth.onAuthStateChange(cb)
  return () => data.subscription.unsubscribe()
}
