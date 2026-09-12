/**
 * Domain-Wide Delegation **sin private key**.
 *
 * El camino es el que documenta Google en «best practices for managing service
 * account keys»:
 *
 *   > When using domain-wide delegation, avoid service account keys and use the
 *   > signJwt API instead
 *
 *   1. El runtime se autentica como la service account — acá, porque Cloud Run
 *      la tiene ADJUNTA y el metadata server entrega el token.
 *   2. Se arma un JWT con el claim `sub` = el buzón a impersonar.
 *   3. Se firma con `iamcredentials.signJwt`, que usa la clave que **Google
 *      administra y nunca entrega**.
 *   4. Se cambia esa aserción por un access token de Gmail.
 *
 * En ningún punto existe un archivo de private key.
 *
 * OJO con la confusión clásica: `generateAccessToken` NO sirve para esto. Da un
 * token *de la service account* y no acepta ningún campo de usuario. Impersonar
 * una service account y delegar en un usuario del dominio son cosas distintas.
 *
 * Nada de lo que pasa por acá se loguea: ni la aserción, ni el token.
 */

const METADATA = 'http://metadata.google.internal/computeMetadata/v1'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const IAM_CREDENTIALS = 'https://iamcredentials.googleapis.com/v1'

/** Margen antes del vencimiento real: nunca se usa un token al filo. */
const MARGEN_SEGUNDOS = 120

export interface ClaimsDwd {
  iss: string
  sub: string
  scope: string
  aud: string
  iat: number
  exp: number
}

/**
 * Arma los claims exactos que Google documenta para DWD.
 *
 * Se separa de la firma para poder probarlo sin red — que es justo donde se
 * cometen los errores: un `aud` mal puesto o un `exp` de más de una hora.
 */
export function construirClaims(opciones: {
  serviceAccount: string
  buzon: string
  scope: string
  ahoraSegundos: number
  duracionSegundos?: number
}): ClaimsDwd {
  const duracion = opciones.duracionSegundos ?? 3600
  // Google: «This value has a maximum of 1 hour after the issued time».
  if (duracion > 3600) {
    throw new Error('La aserción DWD no puede durar más de una hora')
  }
  return {
    iss: opciones.serviceAccount,
    sub: opciones.buzon,
    scope: opciones.scope,
    aud: TOKEN_ENDPOINT,
    iat: opciones.ahoraSegundos,
    exp: opciones.ahoraSegundos + duracion,
  }
}

/** Token de la identidad adjunta, para poder llamar a `signJwt`. */
async function tokenDelMetadataServer(): Promise<string> {
  const r = await fetch(`${METADATA}/instance/service-accounts/default/token`, {
    headers: { 'Metadata-Flavor': 'Google' },
  })
  if (!r.ok) {
    throw new Error(`metadata server: HTTP ${r.status}`)
  }
  const j = (await r.json()) as { access_token?: string }
  if (!j.access_token) throw new Error('el metadata server no devolvió access_token')
  return j.access_token
}

async function firmarConIam(
  claims: ClaimsDwd,
  serviceAccount: string,
  tokenRuntime: string,
): Promise<string> {
  const nombre = `projects/-/serviceAccounts/${serviceAccount}`
  const r = await fetch(`${IAM_CREDENTIALS}/${nombre}:signJwt`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenRuntime}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ payload: JSON.stringify(claims) }),
  })
  if (!r.ok) {
    // El cuerpo puede traer detalle del permiso que falta. No trae secretos.
    const detalle = await r.text().catch(() => '')
    throw new Error(`signJwt: HTTP ${r.status} ${detalle.slice(0, 200)}`)
  }
  const j = (await r.json()) as { signedJwt?: string }
  if (!j.signedJwt) throw new Error('signJwt no devolvió signedJwt')
  return j.signedJwt
}

async function canjearAsercion(asercion: string): Promise<{ token: string; expiraEn: number }> {
  const r = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: asercion,
    }),
  })
  if (!r.ok) {
    const detalle = await r.text().catch(() => '')
    // Acá aparece `unauthorized_client` si la delegación no está autorizada en
    // la consola de Admin para este Client ID y este scope. Es el error que
    // detecta que DWD no quedó bien configurado.
    throw new Error(`token endpoint: HTTP ${r.status} ${detalle.slice(0, 200)}`)
  }
  const j = (await r.json()) as { access_token?: string; expires_in?: number }
  if (!j.access_token) throw new Error('el token endpoint no devolvió access_token')
  return { token: j.access_token, expiraEn: j.expires_in ?? 3600 }
}

interface Entrada {
  token: string
  venceEn: number
}

/**
 * Cachea el access token por buzón hasta poco antes de que venza.
 *
 * En memoria, nunca en la base y nunca hacia el frontend. Cloud Run puede tener
 * varias instancias y cada una tendrá su propia copia: no importa, pedir un
 * token de más es barato y no hay estado compartido que corromper.
 */
export class ProveedorDeTokens {
  private readonly cache = new Map<string, Entrada>()

  constructor(
    private readonly serviceAccount: string,
    private readonly scope: string,
    private readonly ahora: () => number = () => Date.now(),
    private readonly obtener: (buzon: string) => Promise<{ token: string; expiraEn: number }> = async (
      buzon,
    ) => {
      const tokenRuntime = await tokenDelMetadataServer()
      const claims = construirClaims({
        serviceAccount: this.serviceAccount,
        buzon,
        scope: this.scope,
        ahoraSegundos: Math.floor(this.ahora() / 1000),
      })
      const asercion = await firmarConIam(claims, this.serviceAccount, tokenRuntime)
      return canjearAsercion(asercion)
    },
  ) {}

  async para(buzon: string): Promise<string> {
    const guardado = this.cache.get(buzon)
    if (guardado && guardado.venceEn > this.ahora()) {
      return guardado.token
    }
    const { token, expiraEn } = await this.obtener(buzon)
    this.cache.set(buzon, {
      token,
      venceEn: this.ahora() + (expiraEn - MARGEN_SEGUNDOS) * 1000,
    })
    return token
  }

  /** Para forzar una renovación tras un 401 de Gmail. */
  invalidar(buzon: string): void {
    this.cache.delete(buzon)
  }
}
