/**
 * Helpers PUROS del flujo "Iniciar sesión con Google" (OAuth per-cuenta).
 *
 * Nada de red acá: sólo firmar/verificar el `state`, armar la URL de
 * consentimiento y parsear el callback. Todo lo que toca Google o la base vive
 * en el servidor; esto corre en vitest.
 *
 * ── Por qué el `state` va firmado ───────────────────────────────────────────
 *
 * El callback de Google es un redirect del navegador: NO trae el JWT de la
 * persona. La identidad (qué empresa y qué usuario iniciaron la conexión) viaja
 * en el `state`, y por eso tiene que venir firmado —si no, cualquiera podría
 * pedir que se conecte una casilla a una empresa ajena—. Se firma en `/start`,
 * donde el JWT del usuario SÍ está y ya se validó que es admin, y se verifica en
 * el callback antes de persistir nada. La firma es HMAC con la misma clave que
 * firma los envíos (`EMAIL_API_HMAC`).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface EstadoOAuth {
  /** La empresa a la que se conecta la casilla. */
  company: string
  /** El usuario (auth.users.id) que inició, ya validado como admin en /start. */
  usuario: string
  /** A dónde volver en la app después del callback. */
  retorno: string
  /** Un solo uso / anti-replay, y para distinguir dos intentos. */
  nonce: string
  /** Epoch ms de emisión, para caducar el `state`. */
  iat: number
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function desB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function firma(datos: string, clave: Buffer): Buffer {
  return createHmac('sha256', clave).update(datos).digest()
}

/** `state` = base64url(JSON) + '.' + base64url(HMAC). */
export function firmarEstado(estado: EstadoOAuth, clave: Buffer): string {
  const cuerpo = b64url(Buffer.from(JSON.stringify(estado), 'utf8'))
  return `${cuerpo}.${b64url(firma(cuerpo, clave))}`
}

export type ResultadoEstado =
  | { ok: true; estado: EstadoOAuth }
  | { ok: false; motivo: 'formato' | 'firma' | 'vencido' | 'invalido' }

export function verificarEstado(
  state: string,
  clave: Buffer,
  maxEdadMs = 10 * 60_000,
  ahora: () => number = () => Date.now(),
): ResultadoEstado {
  const partes = state.split('.')
  if (partes.length !== 2) return { ok: false, motivo: 'formato' }
  const [cuerpo, sig] = partes as [string, string]

  const esperada = firma(cuerpo, clave)
  const recibida = desB64url(sig)
  // timingSafeEqual exige igual largo: si no coinciden, es firma inválida.
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) {
    return { ok: false, motivo: 'firma' }
  }

  let estado: EstadoOAuth
  try {
    const crudo = JSON.parse(desB64url(cuerpo).toString('utf8')) as Partial<EstadoOAuth>
    if (
      typeof crudo.company !== 'string' ||
      typeof crudo.usuario !== 'string' ||
      typeof crudo.retorno !== 'string' ||
      typeof crudo.nonce !== 'string' ||
      typeof crudo.iat !== 'number'
    ) {
      return { ok: false, motivo: 'invalido' }
    }
    estado = crudo as EstadoOAuth
  } catch {
    return { ok: false, motivo: 'invalido' }
  }

  if (ahora() - estado.iat > maxEdadMs) return { ok: false, motivo: 'vencido' }
  return { ok: true, estado }
}

/** El scope que se pide: leer+modificar+enviar (gmail.modify incluye send) e identidad. */
export const SCOPES_OAUTH = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
] as const

/**
 * La URL del consentimiento de Google.
 *
 * `access_type=offline` + `prompt=consent` son lo que hace que Google devuelva
 * un refresh token (sin eso, sólo un access token que no sirve para sincronizar
 * en segundo plano). `include_granted_scopes` para no perder permisos previos.
 */
export function urlConsentimiento(opciones: {
  clientId: string
  redirectUri: string
  state: string
  scopes?: readonly string[]
  loginHint?: string | undefined
}): string {
  const p = new URLSearchParams({
    client_id: opciones.clientId,
    redirect_uri: opciones.redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: (opciones.scopes ?? SCOPES_OAUTH).join(' '),
    state: opciones.state,
  })
  if (opciones.loginHint) p.set('login_hint', opciones.loginHint)
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`
}

export type Callback =
  | { ok: true; code: string; state: string }
  | { ok: false; error: string }

/** Lee el `?code=&state=` (o `?error=`) del callback de Google. */
export function parsearCallback(query: URLSearchParams): Callback {
  const error = query.get('error')
  if (error) return { ok: false, error }
  const code = query.get('code')
  const state = query.get('state')
  if (!code || !state) return { ok: false, error: 'faltan code o state' }
  return { ok: true, code, state }
}
