import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase/client'
import { getEnv } from '@/lib/env'
import type { MotivoEnlace } from './callbackUrl'
import { callbackPendiente, olvidarCallback } from './capturarCallback'
import { traducirErrorContrasena } from './contrasena'
import { limpiarContrasenaPendiente, marcarContrasenaPendiente } from './contrasenaPendiente'

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
  limpiarContrasenaPendiente()
  await supabase.auth.signOut()
}

// ── Recuperación e invitación ───────────────────────────────────────────────

export type ResultadoRecuperacion = 'enviado' | 'limite' | 'sin_red' | 'error'

/**
 * Pide el correo de recuperación a Supabase Auth (`POST /auth/v1/recover`).
 *
 * Va directo al endpoint oficial y no por `resetPasswordForEmail` porque el
 * cliente usa PKCE: con PKCE el enlace sólo funciona en el MISMO navegador que
 * lo pidió (el verificador queda en su localStorage), y quien pide el correo
 * en la computadora lo suele abrir en el teléfono. Sin PKCE el enlace vuelve
 * con la sesión en el fragmento, que `capturarCallback` procesa.
 *
 * NO distingue si el email existe: 200, 400 o 422 son «enviado». Sólo se
 * informa lo que no revela nada de la cuenta: límite de envíos o sin red.
 */
export async function solicitarRecuperacion(email: string): Promise<ResultadoRecuperacion> {
  const env = getEnv()
  const destino = `${window.location.origin}${import.meta.env.BASE_URL}`
  let r: Response
  try {
    r = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(destino)}`, {
      method: 'POST',
      headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
      credentials: 'omit',
      cache: 'no-store',
    })
  } catch {
    return 'sin_red'
  }
  if (r.status === 429) return 'limite'
  if (r.status >= 500) return 'error'
  return 'enviado'
}

export type ResultadoEnlace =
  | { ok: true; motivo: MotivoEnlace }
  | { ok: false; codigo: 'enlace_vencido' | 'enlace_invalido' | 'sin_enlace' }

let procesando: Promise<ResultadoEnlace> | null = null

/**
 * Establece la sesión que trajo un enlace de invitación o de recuperación.
 *
 * Memoizada: StrictMode monta dos veces y el token es de un solo uso para el
 * refresh; se procesa una vez por carga de página.
 */
export function procesarEnlaceDeAuth(): Promise<ResultadoEnlace> {
  procesando ??= (async (): Promise<ResultadoEnlace> => {
    const cb = callbackPendiente()
    olvidarCallback()
    if (!cb) return { ok: false, codigo: 'sin_enlace' }
    if (cb.tipo === 'error') {
      return { ok: false, codigo: /expired/i.test(cb.codigo) ? 'enlace_vencido' : 'enlace_invalido' }
    }
    const { error } = await supabase.auth.setSession({ access_token: cb.accessToken, refresh_token: cb.refreshToken })
    if (error) return { ok: false, codigo: 'enlace_invalido' }
    // Sólo invitación y recuperación obligan a elegir contraseña. Otro tipo de
    // enlace (p. ej. magic link) deja la sesión y nada más.
    if (cb.motivo === 'invite' || cb.motivo === 'recovery') marcarContrasenaPendiente(cb.motivo)
    return { ok: true, motivo: cb.motivo }
  })()
  return procesando
}

export async function definirContrasena(contrasena: string): Promise<ResultadoLogin> {
  const { error } = await supabase.auth.updateUser({ password: contrasena })
  if (error) return { ok: false, error: traducirErrorContrasena(error) }
  limpiarContrasenaPendiente()
  return { ok: true }
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
