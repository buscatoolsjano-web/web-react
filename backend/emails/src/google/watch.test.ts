/**
 * El watch mira el buzón entero: sin filtro de INBOX.
 *
 * Se prueba el request REAL que arma el cliente, con `fetch` interceptado: un
 * `labelIds` que vuelva a colarse haría que los mails filtrados fuera del INBOX
 * y las respuestas enviadas desde Gmail llegaran tarde otra vez.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClienteGmailReal, cuerpoWatch } from './gmail.js'

describe('users.watch', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('el cuerpo lleva sólo el topic', () => {
    expect(cuerpoWatch('projects/p/topics/t')).toEqual({ topicName: 'projects/p/topics/t' })
  })

  it('el request real no manda labelIds ni labelFilterBehavior', async () => {
    const pedidos: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      pedidos.push({ url, body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ historyId: '10', expiration: '1800000000000' }), { status: 200 })
    })
    const gmail = new ClienteGmailReal(async () => 'token-falso')
    const r = await gmail.iniciarWatch('buzon@prueba.invalid', 'projects/p/topics/t')
    expect(r).toEqual({ historyId: '10', expiration: '1800000000000' })
    expect(pedidos).toHaveLength(1)
    expect(pedidos[0]?.url).toMatch(/\/users\/buzon%40prueba\.invalid\/watch$/)
    expect(pedidos[0]?.body).toEqual({ topicName: 'projects/p/topics/t' })
    expect(JSON.stringify(pedidos[0]?.body)).not.toMatch(/labelIds|labelFilterBehavior|INBOX/)
  })
})
