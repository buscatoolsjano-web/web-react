/**
 * Las rutas del flujo "Iniciar sesión con Google", en el servicio PÚBLICO.
 *
 *   GET /oauth/google/start?company=<uuid>   (con el JWT del usuario)
 *       → valida admin, arma el `state` firmado y devuelve la URL de Google.
 *   GET /oauth/google/callback?code=&state=  (redirect del navegador desde Google)
 *       → verifica el `state`, cambia el `code` por el refresh token, guarda la
 *         casilla (RPC firmada) y redirige de vuelta a la app.
 *
 * La lógica vive en `resolverStart`/`resolverCallback` (puras, testeables); el
 * servidor sólo arma el req/res alrededor. El callback NO trae JWT: la identidad
 * (empresa + usuario admin) viene firmada en el `state` desde `/start`.
 */
import { randomUUID } from 'node:crypto'
import type { Autorizador } from './autorizacion.js'
import {
  firmarEstado,
  urlConsentimiento,
  verificarEstado,
  parsearCallback,
  SCOPES_OAUTH,
  type EstadoOAuth,
} from '../oauth.js'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export interface DepsOauth {
  clientId: string
  clientSecret: string
  redirectUri: string
  /** Base de la app, p. ej. https://app.buscatools.com. */
  appUrl: string
  claveHmac: Buffer
  autorizador: Autorizador
  store: { vincular(d: VinculoArgs): Promise<string> }
  /** Para ponerle el watch a la casilla AL conectarla (cero espera). */
  gmail?: { iniciarWatch(buzon: string, topic: string): Promise<unknown> }
  /** El topic de Pub/Sub del watch. Si falta, no se pone watch en el acto. */
  pubsubTopic?: string
  pedir?: Fetch
  ahora?: () => number
  nonce?: () => string
}

export interface VinculoArgs {
  company: string
  email: string
  display: string | null
  refreshToken: string
  scope: string
  connectedBy: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** El email del `id_token` (JWT), sin verificar firma: viene de Google por TLS. */
export function emailDeIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null
  try {
    const cuerpo = idToken.split('.')[1] ?? ''
    const j = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as {
      email?: unknown
      email_verified?: unknown
    }
    return typeof j.email === 'string' ? j.email : null
  } catch {
    return null
  }
}

/** Cambia el `code` por tokens en el token endpoint de Google. */
export async function intercambiarCodigo(
  code: string,
  deps: Pick<DepsOauth, 'clientId' | 'clientSecret' | 'redirectUri'>,
  pedir: Fetch = fetch,
): Promise<{ refreshToken: string | null; email: string | null }> {
  const r = await pedir('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: deps.clientId,
      client_secret: deps.clientSecret,
      redirect_uri: deps.redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!r.ok) {
    const detalle = await r.text().catch(() => '')
    throw new Error(`token endpoint: HTTP ${r.status} ${detalle.slice(0, 200)}`)
  }
  const j = (await r.json()) as { refresh_token?: string; id_token?: string }
  return { refreshToken: j.refresh_token ?? null, email: emailDeIdToken(j.id_token) }
}

export interface Respuesta {
  status: number
  body: unknown
}

/** `GET /oauth/google/start`: devuelve `{ url }` para que el frontend redirija. */
export async function resolverStart(deps: DepsOauth, jwt: string, company: string | null): Promise<Respuesta> {
  if (!company || !UUID.test(company)) return { status: 400, body: { error: 'company_invalida' } }
  const uid = deps.autorizador.uidSiAdmin ? await deps.autorizador.uidSiAdmin(jwt, company) : null
  if (!uid) return { status: 403, body: { error: 'no_admin' } }

  const estado: EstadoOAuth = {
    company,
    usuario: uid,
    retorno: `${deps.appUrl.replace(/\/+$/, '')}/emails`,
    nonce: deps.nonce ? deps.nonce() : randomUUID(),
    iat: deps.ahora ? deps.ahora() : Date.now(),
  }
  const url = urlConsentimiento({
    clientId: deps.clientId,
    redirectUri: deps.redirectUri,
    state: firmarEstado(estado, deps.claveHmac),
  })
  return { status: 200, body: { url } }
}

/** A dónde redirige el callback (siempre vuelve a la app, con un flag). */
export async function resolverCallback(deps: DepsOauth, query: URLSearchParams): Promise<{ location: string }> {
  const base = `${deps.appUrl.replace(/\/+$/, '')}/emails`
  const err = (motivo: string) => ({ location: `${base}?correo_error=${encodeURIComponent(motivo)}` })

  const cb = parsearCallback(query)
  if (!cb.ok) return err(cb.error)

  const ver = verificarEstado(cb.state, deps.claveHmac, 10 * 60_000, deps.ahora)
  if (!ver.ok) return err(`state_${ver.motivo}`)

  try {
    const { refreshToken, email } = await intercambiarCodigo(cb.code, deps, deps.pedir ?? fetch)
    if (!refreshToken) return err('sin_refresh_token')
    if (!email) return err('sin_email')

    await deps.store.vincular({
      company: ver.estado.company,
      email,
      display: email,
      refreshToken,
      scope: SCOPES_OAUTH.join(' '),
      connectedBy: ver.estado.usuario,
    })

    // Cero espera: ponerle el watch a la casilla en el acto, así Gmail empieza a
    // empujar al instante y el correo nuevo llega solo. Best-effort: si falla
    // (p. ej. un hipo de red), el scheduler lo reintenta en su pasada; no tiene
    // sentido frustrar una conexión que SÍ quedó guardada por esto.
    if (deps.gmail && deps.pubsubTopic) {
      try {
        await deps.gmail.iniciarWatch(email, deps.pubsubTopic)
      } catch {
        /* el scheduler lo reintenta */
      }
    }

    // Vuelve a la app (retorno viene firmado, lo fijó el servidor en /start).
    return { location: `${ver.estado.retorno}?correo_conectado=${encodeURIComponent(email)}` }
  } catch (e) {
    return err(`fallo:${(e as Error).message.slice(0, 40)}`)
  }
}
