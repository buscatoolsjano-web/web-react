import { describe, it, expect } from 'vitest'
import { construirClaims, ProveedorDeTokens } from './auth.js'

const SA = 'buscatools-erp-email@buscatools-erp-email.iam.gserviceaccount.com'
const SCOPE = 'https://www.googleapis.com/auth/gmail.modify'

describe('claims de la aserción DWD', () => {
  it('arma exactamente lo que documenta Google', () => {
    const c = construirClaims({
      serviceAccount: SA,
      buzon: 'info@buscatools.com.ar',
      scope: SCOPE,
      ahoraSegundos: 1_700_000_000,
    })

    expect(c.iss).toBe(SA)
    // `sub` es lo que convierte una impersonación de service account en DWD.
    expect(c.sub).toBe('info@buscatools.com.ar')
    expect(c.scope).toBe(SCOPE)
    expect(c.aud).toBe('https://oauth2.googleapis.com/token')
    expect(c.iat).toBe(1_700_000_000)
    expect(c.exp).toBe(1_700_003_600)
  })

  it('rechaza una aserción de más de una hora', () => {
    // Google: «This value has a maximum of 1 hour after the issued time».
    expect(() =>
      construirClaims({
        serviceAccount: SA, buzon: 'x@y.invalid', scope: SCOPE,
        ahoraSegundos: 0, duracionSegundos: 3601,
      }),
    ).toThrow(/más de una hora/)
  })

  it('nunca pide el scope de borrado permanente', () => {
    const c = construirClaims({
      serviceAccount: SA, buzon: 'x@y.invalid', scope: SCOPE, ahoraSegundos: 0,
    })
    expect(c.scope).not.toContain('https://mail.google.com/')
  })
})

describe('caché de tokens', () => {
  function proveedor(reloj: { t: number }, pedidos: string[]) {
    return new ProveedorDeTokens(
      SA, SCOPE,
      () => reloj.t,
      async (buzon) => {
        pedidos.push(buzon)
        return { token: `tok-${pedidos.length}`, expiraEn: 3600 }
      },
    )
  }

  it('no pide un token nuevo en cada llamada', async () => {
    const reloj = { t: 0 }
    const pedidos: string[] = []
    const p = proveedor(reloj, pedidos)

    expect(await p.para('a@x.invalid')).toBe('tok-1')
    expect(await p.para('a@x.invalid')).toBe('tok-1')
    expect(pedidos).toHaveLength(1)
  })

  it('renueva antes de que venza, no al filo', async () => {
    const reloj = { t: 0 }
    const pedidos: string[] = []
    const p = proveedor(reloj, pedidos)

    await p.para('a@x.invalid')
    // 3540 s: todavía no venció, pero está dentro del margen de 120 s.
    reloj.t = 3_540_000
    expect(await p.para('a@x.invalid')).toBe('tok-2')
  })

  it('cachea por buzón, no globalmente', async () => {
    const reloj = { t: 0 }
    const pedidos: string[] = []
    const p = proveedor(reloj, pedidos)

    await p.para('a@x.invalid')
    await p.para('b@x.invalid')
    expect(pedidos).toEqual(['a@x.invalid', 'b@x.invalid'])
  })

  it('invalidar fuerza una renovación, que es lo que hay que hacer tras un 401', async () => {
    const reloj = { t: 0 }
    const pedidos: string[] = []
    const p = proveedor(reloj, pedidos)

    await p.para('a@x.invalid')
    p.invalidar('a@x.invalid')
    expect(await p.para('a@x.invalid')).toBe('tok-2')
  })
})
