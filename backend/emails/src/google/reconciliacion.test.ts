/**
 * La búsqueda REAL de reconciliación, con `fetch` interceptado: qué le pide a
 * Gmail y cómo decide qué es una coincidencia.
 *
 * Importa porque Gmail reemplaza el Message-ID: la única clave es la cabecera
 * propia, y la búsqueda tiene que ser acotada (SENT, ventana de tiempo, tope)
 * y leer sólo esa cabecera.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CABECERA_REQUEST_ID, ClienteGmailReal, TOPE_RECONCILIACION } from './gmail.js'
import type { OpcionesReintento } from './reintentos.js'

const CRID = '5d0b8c0e-7a1f-4a39-9c1e-2f7e0c1b9a10'
const SIN_REINTENTOS: OpcionesReintento = { intentos: 1, baseMs: 1, topeMs: 1, azar: () => 0, dormir: async () => undefined }

function gmailFalsoHttp(sent: Array<{ id: string; threadId: string; requestId?: string }>, porPagina = 50) {
  const pedidos: URL[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    const u = new URL(url)
    pedidos.push(u)
    const lista = /\/messages$/.test(u.pathname)
    if (lista) {
      const desde = Number(u.searchParams.get('pageToken') ?? 0)
      const pagina = sent.slice(desde, desde + porPagina)
      const siguiente = desde + porPagina < sent.length ? String(desde + porPagina) : undefined
      return new Response(JSON.stringify({ messages: pagina.map(({ id, threadId }) => ({ id, threadId })), ...(siguiente ? { nextPageToken: siguiente } : {}) }), { status: 200 })
    }
    const id = decodeURIComponent(u.pathname.split('/').pop() ?? '')
    const m = sent.find((x) => x.id === id)
    const headers = m?.requestId ? [{ name: CABECERA_REQUEST_ID, value: m.requestId }] : []
    return new Response(JSON.stringify({ id, threadId: m?.threadId, labelIds: ['SENT'], payload: { headers } }), { status: 200 })
  })
  return pedidos
}

describe('reconciliación por X-BT-Request-Id contra la API de Gmail', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('pide SENT (incluida la papelera) en la ventana, y de cada mensaje SÓLO la cabecera propia en format=metadata', async () => {
    const pedidos = gmailFalsoHttp([
      { id: 'a1', threadId: 't1', requestId: 'otro-id' },
      { id: 'a2', threadId: 't2', requestId: CRID },
      { id: 'a3', threadId: 't3' },
    ])
    const g = new ClienteGmailReal(async () => 'token-falso', SIN_REINTENTOS)
    const r = await g.buscarEnviadosPorRequestId('buzon@prueba.invalid', CRID, 1_789_313_700_000, 1_789_314_600_000)
    expect(r).toEqual({ coincidencias: [{ id: 'a2', threadId: 't2' }], revisados: 3, completa: true })

    const lista = pedidos[0]!
    expect(lista.pathname).toMatch(/\/users\/buzon%40prueba\.invalid\/messages$/)
    expect(lista.searchParams.get('labelIds')).toBe('SENT')
    expect(lista.searchParams.get('includeSpamTrash')).toBe('true')
    expect(lista.searchParams.get('q')).toBe('after:1789313700 before:1789314600')
    for (const p of pedidos.slice(1)) {
      expect(p.searchParams.get('format')).toBe('metadata')
      expect(p.searchParams.getAll('metadataHeaders')).toEqual([CABECERA_REQUEST_ID])
    }
  })

  it('coincidencia EXACTA: un prefijo, otro request id o la cabecera ausente no cuentan', async () => {
    gmailFalsoHttp([
      { id: 'b1', threadId: 't', requestId: CRID.slice(0, 20) },
      { id: 'b2', threadId: 't', requestId: `${CRID}x` },
      { id: 'b3', threadId: 't' },
    ])
    const g = new ClienteGmailReal(async () => 'token-falso', SIN_REINTENTOS)
    expect((await g.buscarEnviadosPorRequestId('b@prueba.invalid', CRID, 0, 1)).coincidencias).toEqual([])
  })

  it('devuelve TODAS las coincidencias (dos mensajes con el mismo id): decidir es de quien llama', async () => {
    gmailFalsoHttp([
      { id: 'c1', threadId: 't', requestId: CRID },
      { id: 'c2', threadId: 't', requestId: CRID },
    ])
    const g = new ClienteGmailReal(async () => 'token-falso', SIN_REINTENTOS)
    expect((await g.buscarEnviadosPorRequestId('c@prueba.invalid', CRID, 0, 1)).coincidencias).toHaveLength(2)
  })

  it('pagina, pero con tope: una ventana con más mensajes que el tope se informa como INCOMPLETA', async () => {
    const muchos = Array.from({ length: TOPE_RECONCILIACION + 30 }, (_, i) => ({ id: `d${i}`, threadId: 't' }))
    const pedidos = gmailFalsoHttp(muchos)
    const g = new ClienteGmailReal(async () => 'token-falso', SIN_REINTENTOS)
    const r = await g.buscarEnviadosPorRequestId('d@prueba.invalid', CRID, 0, 1)
    expect(r.completa).toBe(false)
    expect(r.revisados).toBe(TOPE_RECONCILIACION)
    expect(pedidos.filter((p) => p.searchParams.get('format') === 'metadata')).toHaveLength(TOPE_RECONCILIACION)
  })

  it('una ventana que entra en dos páginas se revisa entera y es completa', async () => {
    const sent = Array.from({ length: 70 }, (_, i) => ({ id: `e${i}`, threadId: 't', ...(i === 65 ? { requestId: CRID } : {}) }))
    gmailFalsoHttp(sent)
    const g = new ClienteGmailReal(async () => 'token-falso', SIN_REINTENTOS)
    expect(await g.buscarEnviadosPorRequestId('e@prueba.invalid', CRID, 0, 1)).toEqual({ coincidencias: [{ id: 'e65', threadId: 't' }], revisados: 70, completa: true })
  })
})
