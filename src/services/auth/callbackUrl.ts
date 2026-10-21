/**
 * Enlaces de Supabase Auth que vuelven a la app (invitación, recuperación).
 *
 * Con la plantilla por defecto de Supabase —la única disponible sin SMTP
 * propio— el enlace pasa por `/auth/v1/verify` y vuelve a la app con la sesión
 * en el FRAGMENTO:
 *
 *   https://app.buscatools.com/#access_token=…&refresh_token=…&type=invite
 *   https://app.buscatools.com/#error=access_denied&error_code=otp_expired&…
 *
 * Eso choca con flowType 'pkce': el SDK rechaza una sesión en el fragmento
 * («Not a valid PKCE flow url») y no la guarda. (Antes, con router de hash,
 * chocaba además con el router, que leía el fragmento como ruta.)
 *
 * Por eso el fragmento se lee ANTES de montar el router, se saca de la URL y
 * la sesión se establece a mano con `setSession`. Función pura: recibe el href.
 */

export type MotivoEnlace = 'invite' | 'recovery' | 'signup' | 'magiclink' | 'otro'

export type CallbackAuth =
  | { tipo: 'sesion'; motivo: MotivoEnlace; accessToken: string; refreshToken: string }
  | { tipo: 'error'; codigo: string }

const MOTIVOS: readonly MotivoEnlace[] = ['invite', 'recovery', 'signup', 'magiclink']

export function leerCallbackAuth(href: string): CallbackAuth | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : ''
  // Un fragmento que empieza con '/' es una ruta —marcador viejo del hash
  // router—, no un callback: los tokens de Supabase vienen como `access_token=…`.
  if (!hash || hash.startsWith('/')) return null

  const p = new URLSearchParams(hash)
  if (p.get('error') || p.get('error_code')) {
    return { tipo: 'error', codigo: p.get('error_code') || p.get('error') || 'desconocido' }
  }
  const accessToken = p.get('access_token')
  const refreshToken = p.get('refresh_token')
  if (!accessToken || !refreshToken) return null
  const tipo = p.get('type') ?? ''
  const motivo = (MOTIVOS as readonly string[]).includes(tipo) ? (tipo as MotivoEnlace) : 'otro'
  return { tipo: 'sesion', motivo, accessToken, refreshToken }
}

/** Ruta a la que se manda un callback una vez sacados los tokens. */
export const RUTA_DEFINIR_CONTRASENA = '/auth/definir-contrasena'
