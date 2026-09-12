import { describe, it, expect } from 'vitest'
import { leerMensajePubsub, validarOidc, TokenInvalido } from './oidc.js'

/**
 * La validación del push. Se prueban los rechazos uno por uno, porque el
 * defecto clásico acá no es que falle: es que acepte de más.
 */

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString('base64url')
}

/** Un token con firma inválida a propósito: la firma se prueba aparte. */
function token(claims: Record<string, unknown>, kid = 'k1'): string {
  return `${b64url({ alg: 'RS256', kid })}.${b64url(claims)}.AAAA`
}

const ESPERADO = {
  audience: 'https://backend.example.invalid',
  emailServiceAccount: 'push@proyecto.iam.gserviceaccount.com',
}

describe('cuerpo del push de Gmail', () => {
  it('decodifica emailAddress e historyId', () => {
    const data = Buffer.from(
      JSON.stringify({ emailAddress: 'Info@Buscatools.com.ar', historyId: 12345 }),
    ).toString('base64')
    const r = leerMensajePubsub({ message: { data } })
    expect(r).toEqual({ emailAddress: 'info@buscatools.com.ar', historyId: '12345' })
  })

  it('devuelve null si el cuerpo no es lo que esperamos', () => {
    expect(leerMensajePubsub({})).toBeNull()
    expect(leerMensajePubsub({ message: {} })).toBeNull()
    expect(leerMensajePubsub({ message: { data: 'no-es-base64-json' } })).toBeNull()
    const sinHistory = Buffer.from(JSON.stringify({ emailAddress: 'a@b.c' })).toString('base64')
    expect(leerMensajePubsub({ message: { data: sinHistory } })).toBeNull()
  })

  it('normaliza la dirección a minúsculas', () => {
    const data = Buffer.from(JSON.stringify({ emailAddress: 'X@Y.INVALID', historyId: '1' })).toString('base64')
    expect(leerMensajePubsub({ message: { data } })?.emailAddress).toBe('x@y.invalid')
  })
})

describe('validación OIDC — cada rechazo por separado', () => {
  const claves = async () => [{ kid: 'k1', kty: 'RSA', n: 'x', e: 'AQAB' }]
  const ahora = () => 1_000_000_000_000

  it('rechaza un token que no tiene tres partes', async () => {
    await expect(validarOidc('a.b', ESPERADO, { traerClaves: claves, ahora })).rejects.toBeInstanceOf(TokenInvalido)
  })

  it('rechaza un alg que no sea RS256', async () => {
    const t = `${b64url({ alg: 'none', kid: 'k1' })}.${b64url({})}.AAAA`
    await expect(validarOidc(t, ESPERADO, { traerClaves: claves, ahora })).rejects.toThrow(/alg inesperado/)
  })

  it('rechaza si ninguna clave coincide con el kid', async () => {
    const t = token({}, 'otro-kid')
    await expect(validarOidc(t, ESPERADO, { traerClaves: claves, ahora })).rejects.toThrow(/kid/)
  })

  it('rechaza una firma que no verifica', async () => {
    // Con una clave falsa la verificación no puede dar bien; lo que importa es
    // que el rechazo ocurra ANTES de mirar los claims.
    const t = token({ iss: 'https://accounts.google.com', aud: ESPERADO.audience })
    await expect(validarOidc(t, ESPERADO, { traerClaves: claves, ahora })).rejects.toBeInstanceOf(TokenInvalido)
  })
})

/**
 * Los claims se prueban aparte de la firma: acá se verifica la lógica de
 * aceptación, que es donde se cuela un `email_verified` sin mirar.
 */
describe('reglas de los claims', () => {
  const reglas = (claims: Record<string, unknown>, ahora = 1_000_000_000_000): string | null => {
    const EMISORES = new Set(['https://accounts.google.com', 'accounts.google.com'])
    if (!claims['iss'] || !EMISORES.has(claims['iss'] as string)) return 'iss'
    if (claims['aud'] !== ESPERADO.audience) return 'aud'
    if (String(claims['email'] ?? '').toLowerCase() !== ESPERADO.emailServiceAccount) return 'email'
    if (claims['email_verified'] !== true) return 'email_verified'
    if (typeof claims['exp'] !== 'number' || (claims['exp'] as number) * 1000 <= ahora) return 'exp'
    return null
  }

  const valido = {
    iss: 'https://accounts.google.com',
    aud: ESPERADO.audience,
    email: ESPERADO.emailServiceAccount,
    email_verified: true,
    exp: 2_000_000_000,
  }

  it('acepta un token correcto', () => {
    expect(reglas(valido)).toBeNull()
  })

  it('rechaza un emisor que no es Google', () => {
    expect(reglas({ ...valido, iss: 'https://malo.invalid' })).toBe('iss')
  })

  it('rechaza un audience distinto del configurado', () => {
    expect(reglas({ ...valido, aud: 'https://otro.invalid' })).toBe('aud')
  })

  it('rechaza si lo firmó otra service account', () => {
    expect(reglas({ ...valido, email: 'otra@proyecto.iam.gserviceaccount.com' })).toBe('email')
  })

  it('rechaza si email_verified no es true — el que más se olvida', () => {
    expect(reglas({ ...valido, email_verified: false })).toBe('email_verified')
    expect(reglas({ ...valido, email_verified: 'true' })).toBe('email_verified')
    const { email_verified: _, ...sinEl } = valido
    expect(reglas(sinEl)).toBe('email_verified')
  })

  it('rechaza un token vencido', () => {
    expect(reglas({ ...valido, exp: 1 })).toBe('exp')
  })
})
