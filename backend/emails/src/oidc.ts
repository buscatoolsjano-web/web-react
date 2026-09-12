/**
 * Validación del token OIDC con que Pub/Sub firma el push.
 *
 * No alcanza con «Cloud Run ya está protegido». Cloud Run comprueba que quien
 * llama tiene permiso de invocar; este archivo comprueba que quien llama es
 * **la subscription que esperamos**, con el audience que configuramos. Son dos
 * cosas distintas y hacen falta las dos.
 *
 * Lo que Google documenta que hay que validar:
 *
 *   · la firma, contra sus claves públicas
 *   · `iss` = https://accounts.google.com
 *   · `aud` = el audience configurado en la subscription
 *   · `email` = la service account de push
 *   · `email_verified` = true
 *
 * Se verifican los cinco. Saltear el último es un clásico.
 */

const CERTS = 'https://www.googleapis.com/oauth2/v3/certs'
const EMISORES = new Set(['https://accounts.google.com', 'accounts.google.com'])

interface Jwk {
  kid: string
  n: string
  e: string
  alg?: string
  kty: string
}

interface ClaimsOidc {
  iss?: string
  aud?: string
  email?: string
  email_verified?: boolean
  exp?: number
  iat?: number
}

function desdeBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const relleno = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const buf = Buffer.from(relleno, 'base64')
  // Se copia a un ArrayBuffer propio: el Buffer de Node comparte un pool, y
  // crypto.subtle no acepta un Uint8Array respaldado por ArrayBufferLike.
  const salida = new Uint8Array(buf.length)
  salida.set(buf)
  return salida
}

function textoDesdeBase64Url(s: string): string {
  return Buffer.from(desdeBase64Url(s)).toString('utf8')
}

/** Caché de las claves públicas de Google. Rotan, pero no cada minuto. */
let cacheClaves: { claves: Jwk[]; venceEn: number } | null = null

async function clavesDeGoogle(ahora: () => number): Promise<Jwk[]> {
  if (cacheClaves && cacheClaves.venceEn > ahora()) return cacheClaves.claves
  const r = await fetch(CERTS)
  if (!r.ok) throw new Error(`no se pudieron leer las claves de Google: HTTP ${r.status}`)
  const j = (await r.json()) as { keys?: Jwk[] }
  const claves = j.keys ?? []
  // Una hora es conservador y evita pegarle a Google en cada push.
  cacheClaves = { claves, venceEn: ahora() + 3600_000 }
  return claves
}

export interface EsperadoOidc {
  audience: string
  emailServiceAccount: string
}

export class TokenInvalido extends Error {
  constructor(motivo: string) {
    super(motivo)
    this.name = 'TokenInvalido'
  }
}

/**
 * Devuelve los claims si el token es válido; tira `TokenInvalido` si no.
 *
 * `traerClaves` y `ahora` se inyectan para poder probar sin red ni reloj real.
 */
export async function validarOidc(
  token: string,
  esperado: EsperadoOidc,
  opciones?: { traerClaves?: () => Promise<Jwk[]>; ahora?: () => number },
): Promise<ClaimsOidc> {
  const ahora = opciones?.ahora ?? (() => Date.now())
  const partes = token.split('.')
  if (partes.length !== 3) throw new TokenInvalido('el token no tiene tres partes')
  const [cabeceraB64, cuerpoB64, firmaB64] = partes as [string, string, string]

  const cabecera = JSON.parse(textoDesdeBase64Url(cabeceraB64)) as { kid?: string; alg?: string }
  if (cabecera.alg !== 'RS256') throw new TokenInvalido(`alg inesperado: ${cabecera.alg}`)
  if (!cabecera.kid) throw new TokenInvalido('el token no trae kid')

  const claves = await (opciones?.traerClaves ?? (() => clavesDeGoogle(ahora)))()
  const jwk = claves.find((k) => k.kid === cabecera.kid)
  if (!jwk) throw new TokenInvalido('ninguna clave de Google coincide con el kid')

  const clave = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const firmaOk = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    clave,
    desdeBase64Url(firmaB64),
    new TextEncoder().encode(`${cabeceraB64}.${cuerpoB64}`),
  )
  if (!firmaOk) throw new TokenInvalido('la firma no verifica')

  const claims = JSON.parse(textoDesdeBase64Url(cuerpoB64)) as ClaimsOidc

  if (!claims.iss || !EMISORES.has(claims.iss)) throw new TokenInvalido(`iss inesperado: ${claims.iss}`)
  if (claims.aud !== esperado.audience) throw new TokenInvalido('aud inesperado')
  if ((claims.email ?? '').toLowerCase() !== esperado.emailServiceAccount.toLowerCase()) {
    throw new TokenInvalido('el token no lo firmó la service account esperada')
  }
  // El que más se olvida, y sin él el `email` no significa nada.
  if (claims.email_verified !== true) throw new TokenInvalido('email_verified no es true')
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= ahora()) {
    throw new TokenInvalido('el token venció')
  }

  return claims
}

/**
 * El cuerpo que manda Gmail por Pub/Sub: `{emailAddress, historyId}` en
 * base64url dentro de `message.data`.
 */
export function leerMensajePubsub(cuerpo: unknown): { emailAddress: string; historyId: string } | null {
  const c = cuerpo as { message?: { data?: string } } | undefined
  if (!c?.message?.data) return null
  try {
    const j = JSON.parse(Buffer.from(c.message.data, 'base64').toString('utf8')) as {
      emailAddress?: string
      historyId?: string | number
    }
    if (!j.emailAddress || j.historyId === undefined) return null
    return { emailAddress: String(j.emailAddress).toLowerCase(), historyId: String(j.historyId) }
  } catch {
    return null
  }
}
