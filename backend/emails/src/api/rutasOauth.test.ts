import { describe, it, expect } from 'vitest'
import {
  emailDeIdToken,
  intercambiarCodigo,
  resolverStart,
  resolverCallback,
  type DepsOauth,
} from './rutasOauth.js'
import { firmarEstado } from '../oauth.js'
import type { Autorizador } from './autorizacion.js'

const CLAVE = Buffer.from('c'.repeat(64), 'hex')
const COMPANY = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
const UID = 'ef829295-3992-40c8-b85b-49a6d1713d5a'

function idTokenCon(email: string): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o), 'utf8').toString('base64url')
  return `${b64({ alg: 'RS256' })}.${b64({ email, email_verified: true })}.firma`
}

function depsBase(over: Partial<DepsOauth> = {}): DepsOauth {
  const autorizador = {
    async autorizarHilo() { throw new Error('no se usa') },
    async autorizarCuenta() { throw new Error('no se usa') },
    async uidSiAdmin() { return UID },
  } as unknown as Autorizador
  return {
    clientId: 'cid.apps.googleusercontent.com',
    clientSecret: 'secreto',
    redirectUri: 'https://api.example/oauth/google/callback',
    appUrl: 'https://app.buscatools.com',
    claveHmac: CLAVE,
    autorizador,
    store: { async vincular() { return 'acc-nuevo' } },
    ahora: () => 1_700_000_000_000,
    nonce: () => 'n-fijo',
    ...over,
  }
}

describe('emailDeIdToken', () => {
  it('saca el email del payload', () => {
    expect(emailDeIdToken(idTokenCon('ventas@empresa.com'))).toBe('ventas@empresa.com')
  })
  it('sin token o roto => null', () => {
    expect(emailDeIdToken(undefined)).toBeNull()
    expect(emailDeIdToken('roto')).toBeNull()
  })
})

describe('intercambiarCodigo', () => {
  it('devuelve refresh token y email', async () => {
    const pedir = (async () =>
      new Response(JSON.stringify({ refresh_token: 'r-1', id_token: idTokenCon('a@b.com') }), { status: 200 })) as unknown as typeof fetch
    const r = await intercambiarCodigo('el-code', { clientId: 'c', clientSecret: 's', redirectUri: 'u' }, pedir)
    expect(r).toEqual({ refreshToken: 'r-1', email: 'a@b.com' })
  })
  it('un error de Google tira', async () => {
    const pedir = (async () => new Response('nope', { status: 400 })) as unknown as typeof fetch
    await expect(intercambiarCodigo('x', { clientId: 'c', clientSecret: 's', redirectUri: 'u' }, pedir)).rejects.toThrow(/HTTP 400/)
  })
})

describe('resolverStart', () => {
  it('admin: devuelve la URL de Google con el state firmado', async () => {
    const r = await resolverStart(depsBase(), 'jwt', COMPANY)
    expect(r.status).toBe(200)
    const url = new URL((r.body as { url: string }).url)
    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.searchParams.get('client_id')).toBe('cid.apps.googleusercontent.com')
    expect(url.searchParams.get('state')).toBeTruthy()
  })
  it('no admin: 403', async () => {
    const deps = depsBase({ autorizador: { async uidSiAdmin() { return null } } as unknown as Autorizador })
    expect((await resolverStart(deps, 'jwt', COMPANY)).status).toBe(403)
  })
  it('company inválida: 400', async () => {
    expect((await resolverStart(depsBase(), 'jwt', 'no-uuid')).status).toBe(400)
  })
})

describe('resolverCallback', () => {
  const stateValido = (over = {}) =>
    firmarEstado({ company: COMPANY, usuario: UID, retorno: 'https://app.buscatools.com/emails', nonce: 'n', iat: 1_700_000_000_000, ...over }, CLAVE)

  it('happy path: intercambia, vincula y vuelve a la app con la casilla conectada', async () => {
    let vinculado: unknown = null
    const deps = depsBase({
      pedir: (async () => new Response(JSON.stringify({ refresh_token: 'r', id_token: idTokenCon('nuevo@casilla.com') }), { status: 200 })) as unknown as typeof fetch,
      store: { async vincular(d) { vinculado = d; return 'acc-1' } },
    })
    const q = new URLSearchParams({ code: 'c', state: stateValido() })
    const r = await resolverCallback(deps, q)
    expect(r.location).toBe('https://app.buscatools.com/emails?correo_conectado=nuevo%40casilla.com')
    expect(vinculado).toMatchObject({ company: COMPANY, email: 'nuevo@casilla.com', connectedBy: UID })
  })

  it('cero espera: al conectar le pone el watch a la casilla', async () => {
    const watches: Array<{ buzon: string; topic: string }> = []
    const deps = depsBase({
      pedir: (async () => new Response(JSON.stringify({ refresh_token: 'r', id_token: idTokenCon('n@c.com') }), { status: 200 })) as unknown as typeof fetch,
      gmail: { async iniciarWatch(buzon: string, topic: string) { watches.push({ buzon, topic }); return {} } },
      pubsubTopic: 'projects/p/topics/gmail',
    })
    const r = await resolverCallback(deps, new URLSearchParams({ code: 'c', state: stateValido() }))
    expect(r.location).toContain('correo_conectado=')
    expect(watches).toEqual([{ buzon: 'n@c.com', topic: 'projects/p/topics/gmail' }])
  })

  it('si el watch falla, la conexión igual queda hecha (best-effort)', async () => {
    const deps = depsBase({
      pedir: (async () => new Response(JSON.stringify({ refresh_token: 'r', id_token: idTokenCon('n@c.com') }), { status: 200 })) as unknown as typeof fetch,
      gmail: { async iniciarWatch() { throw new Error('gmail caido') } },
      pubsubTopic: 'projects/p/topics/gmail',
    })
    const r = await resolverCallback(deps, new URLSearchParams({ code: 'c', state: stateValido() }))
    expect(r.location).toContain('correo_conectado=')
  })

  it('error de Google: vuelve con correo_error', async () => {
    const r = await resolverCallback(depsBase(), new URLSearchParams({ error: 'access_denied' }))
    expect(r.location).toContain('correo_error=access_denied')
  })

  it('state inválido: no intercambia nada', async () => {
    const r = await resolverCallback(depsBase(), new URLSearchParams({ code: 'c', state: 'falso.firma' }))
    expect(r.location).toContain('correo_error=state_')
  })

  it('sin refresh token (Google no lo devolvió): avisa', async () => {
    const deps = depsBase({
      pedir: (async () => new Response(JSON.stringify({ id_token: idTokenCon('a@b.com') }), { status: 200 })) as unknown as typeof fetch,
    })
    const r = await resolverCallback(deps, new URLSearchParams({ code: 'c', state: stateValido() }))
    expect(r.location).toContain('correo_error=sin_refresh_token')
  })
})
