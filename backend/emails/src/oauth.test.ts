import { describe, it, expect } from 'vitest'
import {
  firmarEstado,
  verificarEstado,
  urlConsentimiento,
  parsearCallback,
  type EstadoOAuth,
} from './oauth.js'

const CLAVE = Buffer.from('a'.repeat(64), 'hex')
const OTRA = Buffer.from('b'.repeat(64), 'hex')

const ESTADO: EstadoOAuth = {
  company: 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c',
  usuario: 'ef829295-3992-40c8-b85b-49a6d1713d5a',
  retorno: 'https://app.buscatools.com/emails',
  nonce: 'n-123',
  iat: 1_700_000_000_000,
}

describe('state firmado del OAuth', () => {
  it('ida y vuelta: lo que se firma se verifica', () => {
    const s = firmarEstado(ESTADO, CLAVE)
    const r = verificarEstado(s, CLAVE, 10 * 60_000, () => ESTADO.iat + 1000)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.estado).toEqual(ESTADO)
  })

  it('una firma con otra clave se rechaza (no confiar en un state ajeno)', () => {
    const s = firmarEstado(ESTADO, CLAVE)
    const r = verificarEstado(s, OTRA, 10 * 60_000, () => ESTADO.iat + 1000)
    expect(r).toEqual({ ok: false, motivo: 'firma' })
  })

  it('un cuerpo manipulado invalida la firma', () => {
    const s = firmarEstado(ESTADO, CLAVE)
    const [, sig] = s.split('.')
    const otroCuerpo = Buffer.from(JSON.stringify({ ...ESTADO, company: 'otra' }), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const r = verificarEstado(`${otroCuerpo}.${sig}`, CLAVE)
    expect(r.ok).toBe(false)
  })

  it('un state viejo caduca', () => {
    const s = firmarEstado(ESTADO, CLAVE)
    const r = verificarEstado(s, CLAVE, 10 * 60_000, () => ESTADO.iat + 11 * 60_000)
    expect(r).toEqual({ ok: false, motivo: 'vencido' })
  })

  it('formato roto se rechaza sin tirar', () => {
    expect(verificarEstado('sin-punto', CLAVE).ok).toBe(false)
    expect(verificarEstado('a.b.c', CLAVE).ok).toBe(false)
  })
})

describe('URL de consentimiento', () => {
  it('pide refresh token (offline + consent) y el scope de gmail', () => {
    const url = new URL(
      urlConsentimiento({
        clientId: 'cid.apps.googleusercontent.com',
        redirectUri: 'https://api.example.com/oauth/google/callback',
        state: 'el-state',
      }),
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('el-state')
    expect(url.searchParams.get('scope')).toContain('gmail.modify')
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.com/oauth/google/callback')
  })
})

describe('parseo del callback', () => {
  it('devuelve code y state', () => {
    const r = parsearCallback(new URLSearchParams('code=abc&state=xyz'))
    expect(r).toEqual({ ok: true, code: 'abc', state: 'xyz' })
  })
  it('un error de Google se propaga', () => {
    const r = parsearCallback(new URLSearchParams('error=access_denied'))
    expect(r).toEqual({ ok: false, error: 'access_denied' })
  })
  it('sin code falla', () => {
    expect(parsearCallback(new URLSearchParams('state=xyz')).ok).toBe(false)
  })
})
