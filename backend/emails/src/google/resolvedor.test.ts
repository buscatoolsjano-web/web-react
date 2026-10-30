import { describe, it, expect } from 'vitest'
import { resolvedorDeToken, cacheRef, type RefCuenta } from './resolvedor.js'

describe('resolvedor de token por auth_mode', () => {
  const dwd = { para: async (buzon: string) => `dwd:${buzon}` }
  const oauth = { para: async (accountId: string) => `oauth:${accountId}` }

  it('una casilla DWD usa el proveedor de impersonación', async () => {
    const resolver = resolvedorDeToken(
      async () => ({ authMode: 'dwd', accountId: 'a1' }),
      dwd,
      oauth,
    )
    expect(await resolver('info@buscatools.com.ar')).toBe('dwd:info@buscatools.com.ar')
  })

  it('una casilla OAuth usa el proveedor OAuth, por accountId (no por buzón)', async () => {
    const resolver = resolvedorDeToken(
      async () => ({ authMode: 'oauth_user', accountId: 'acc-9' }),
      dwd,
      oauth,
    )
    expect(await resolver('ventas@otraempresa.com')).toBe('oauth:acc-9')
  })

  it('si no se encuentra la casilla, cae a DWD (comportamiento histórico)', async () => {
    const resolver = resolvedorDeToken(async () => null, dwd, oauth)
    expect(await resolver('x@y.invalid')).toBe('dwd:x@y.invalid')
  })
})

describe('cacheRef', () => {
  it('no vuelve a cargar dentro del TTL y recarga después', async () => {
    const reloj = { t: 0 }
    const cargas: string[] = []
    const cargar = async (buzon: string): Promise<RefCuenta | null> => {
      cargas.push(buzon)
      return { authMode: 'dwd', accountId: `a-${cargas.length}` }
    }
    const resolver = cacheRef(cargar, 1000, () => reloj.t)

    await resolver('a@x.invalid')
    await resolver('a@x.invalid')
    expect(cargas).toHaveLength(1) // segunda sale de cache

    reloj.t = 1001
    await resolver('a@x.invalid')
    expect(cargas).toHaveLength(2) // venció el TTL
  })

  it('cachea por buzón', async () => {
    const cargas: string[] = []
    const resolver = cacheRef(async (b) => {
      cargas.push(b)
      return null
    })
    await resolver('a@x.invalid')
    await resolver('b@x.invalid')
    expect(cargas).toEqual(['a@x.invalid', 'b@x.invalid'])
  })
})
