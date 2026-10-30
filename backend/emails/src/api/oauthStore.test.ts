import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { AlmacenOauthFirmado } from './oauthStore.js'

const CLAVE = Buffer.from('f'.repeat(64), 'hex')
const hmac = (msg: string) => createHmac('sha256', CLAVE).update(msg, 'utf8').digest('hex')

function fakeFetch(respuesta: unknown, status = 200) {
  const llamadas: { url: string; body: Record<string, unknown> }[] = []
  const f = (async (url: string, init?: RequestInit) => {
    llamadas.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify(respuesta), { status })
  }) as unknown as typeof fetch
  return { f, llamadas }
}

describe('AlmacenOauthFirmado', () => {
  it('vincular firma el mensaje en el formato EXACTO que espera la RPC', async () => {
    const { f, llamadas } = fakeFetch('acc-xyz')
    const store = new AlmacenOauthFirmado('https://db.example', 'anon-key', CLAVE, f, () => 1_700_000_000_000)
    const acc = await store.vincular({
      company: 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c',
      email: '  Ventas@Empresa.com ',
      display: 'Ventas',
      refreshToken: 'refresh-123',
      scope: 'https://www.googleapis.com/auth/gmail.modify',
      connectedBy: 'ef829295-3992-40c8-b85b-49a6d1713d5a',
    })
    expect(acc).toBe('acc-xyz')

    const { url, body } = llamadas[0]!
    expect(url).toBe('https://db.example/rest/v1/rpc/email_vincular_oauth')
    // email normalizado (trim + minúsculas)
    expect(body['p_email']).toBe('ventas@empresa.com')
    expect(body['p_ts']).toBe(1_700_000_000_000)
    // La firma es sobre concat_ws('|', ...) con el email ya normalizado.
    const esperado = hmac(
      'email_vincular_oauth|1700000000000|bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c|ventas@empresa.com|ef829295-3992-40c8-b85b-49a6d1713d5a|https://www.googleapis.com/auth/gmail.modify',
    )
    expect(body['p_firma']).toBe(esperado)
  })

  it('leerRefresh firma y devuelve el token; vacío => null', async () => {
    const { f, llamadas } = fakeFetch('el-refresh')
    const store = new AlmacenOauthFirmado('https://db.example', 'anon-key', CLAVE, f, () => 1_700_000_000_000)
    const tok = await store.leerRefresh('acc-1')
    expect(tok).toBe('el-refresh')
    const { body } = llamadas[0]!
    expect(body['p_firma']).toBe(hmac('email_leer_refresh|1700000000000|acc-1'))

    const vacio = fakeFetch('')
    const store2 = new AlmacenOauthFirmado('https://db.example', 'anon-key', CLAVE, vacio.f)
    expect(await store2.leerRefresh('acc-1')).toBeNull()
  })

  it('un error de la base se propaga con el mensaje', async () => {
    const { f } = fakeFetch({ message: 'firma_invalida' }, 403)
    const store = new AlmacenOauthFirmado('https://db.example', 'anon-key', CLAVE, f)
    await expect(store.vincular({
      company: 'c', email: 'a@b.com', display: null, refreshToken: 'r', scope: 's', connectedBy: 'u',
    })).rejects.toThrow(/firma_invalida/)
  })
})
