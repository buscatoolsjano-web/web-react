/**
 * El servicio público de la bandeja, sin Gmail real y sin Supabase real.
 *
 * Lo que más importa: **ninguna ruta llega a Gmail sin que antes la RLS haya
 * dicho que la persona ve ese hilo**, y un adjunto sólo se baja si mensaje,
 * hilo y parte están relacionados entre sí.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { GmailFalso } from '../pruebas/dobles.js'
import { ErrorGmail } from '../google/gmail.js'
import {
  AutorizadorSupabase,
  IndiceNoDisponible,
  NoAutenticado,
  NoEncontrado,
  subDelJwt,
  type Autorizador,
  type HiloAutorizado,
} from './autorizacion.js'
import { analizarMensaje, armarHilo, buscarParte, charsetDe, TOPE_CUERPO } from './mensajes.js'
import { construirServidorApi, disposicion } from './servidor.js'

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url')
const CUENTA = '11111111-1111-4111-8111-111111111111'
const HILO = '18f0a1b2c3d4e5f6'
const OTRO_HILO = '18f0ffffffffffff'
const MSG = '18f0a1b2c3d4e5f7'
const ORIGEN = 'https://app.buscatools.com'
const JWT = `${b64('{"alg":"HS256"}')}.${b64('{"sub":"usuario-1"}')}.firma`

function mensajeFixture(threadId = HILO) {
  return {
    id: MSG,
    threadId,
    labelIds: ['INBOX', 'UNREAD'],
    internalDate: '1757700000000',
    payload: {
      partId: '',
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'Cliente <cliente@ejemplo.test>' },
        { name: 'To', value: 'buzon@prueba.invalid' },
        { name: 'Subject', value: 'Pedido de cotización' },
      ],
      parts: [
        {
          partId: '0',
          mimeType: 'multipart/alternative',
          parts: [
            { partId: '0.0', mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }], body: { size: 5, data: b64('Hola ñ') } },
            { partId: '0.1', mimeType: 'text/html', headers: [{ name: 'Content-Type', value: 'text/html; charset="UTF-8"' }], body: { size: 20, data: b64('<p>Hola <img src="cid:logo@x"></p>') } },
          ],
        },
        {
          partId: '1',
          mimeType: 'image/png',
          filename: '',
          headers: [{ name: 'Content-ID', value: '<logo@x>' }, { name: 'Content-Disposition', value: 'inline' }],
          body: { attachmentId: 'ANGjdJ-inline', size: 1234 },
        },
        {
          partId: '2',
          mimeType: 'application/pdf',
          filename: 'factura.pdf',
          headers: [{ name: 'Content-Disposition', value: 'attachment; filename="factura.pdf"' }],
          body: { attachmentId: 'ANGjdJ-pdf', size: 20480 },
        },
        {
          partId: '3',
          mimeType: 'text/html',
          filename: 'phishing.html',
          headers: [{ name: 'Content-Disposition', value: 'attachment' }],
          body: { attachmentId: 'ANGjdJ-html', size: 50 },
        },
      ],
    },
  }
}

describe('analizarMensaje', () => {
  it('separa cuerpo HTML, texto, inline y adjuntos', () => {
    const { payload, pendientes } = analizarMensaje(mensajeFixture())
    expect(payload.asunto).toBe('Pedido de cotización')
    expect(payload.de).toBe('Cliente <cliente@ejemplo.test>')
    expect(payload.texto).toBe('Hola ñ')
    expect(payload.html).toContain('cid:logo@x')
    expect(payload.noLeidoGmail).toBe(true)
    expect(pendientes).toHaveLength(0)
    expect(payload.adjuntos).toEqual([
      { partId: '1', nombre: 'imagen-1', mime: 'image/png', tamano: 1234, contentId: 'logo@x', inline: true },
      { partId: '2', nombre: 'factura.pdf', mime: 'application/pdf', tamano: 20480, contentId: null, inline: false },
      { partId: '3', nombre: 'phishing.html', mime: 'text/html', tamano: 50, contentId: null, inline: false },
    ])
  })

  it('un text/html declarado como adjunto NO es el cuerpo', () => {
    const { payload } = analizarMensaje(mensajeFixture())
    expect(payload.html).not.toContain('phishing')
  })

  it('decodifica el charset declarado', () => {
    expect(charsetDe('text/plain; charset=ISO-8859-1')).toBe('iso-8859-1')
    const m = {
      id: MSG,
      payload: {
        partId: '',
        mimeType: 'text/plain',
        headers: [{ name: 'Content-Type', value: 'text/plain; charset=ISO-8859-1' }],
        body: { data: Buffer.from([0x41, 0xf1, 0x6f]).toString('base64url') },
      },
    }
    expect(analizarMensaje(m).payload.texto).toBe('Año')
  })

  it('REGRESIÓN: bytes UTF-8 con un charset declarado que no es UTF-8 no dan mojibake', () => {
    // El caso real: el header decía us-ascii (windows-1252 para TextDecoder) y los
    // bytes eran UTF-8. Se veía «OpinÃ¡».
    for (const declarado of ['us-ascii', 'iso-8859-1', 'windows-1252']) {
      const m = {
        id: MSG,
        payload: {
          partId: '',
          mimeType: 'text/html',
          headers: [{ name: 'Content-Type', value: `text/html; charset=${declarado}` }],
          body: { data: b64('<p>Opiná desde la app y ganá</p>') },
        },
      }
      expect(analizarMensaje(m).payload.html).toBe('<p>Opiná desde la app y ganá</p>')
    }
  })

  it('windows-1252 real (comillas tipográficas) se sigue decodificando con su charset', () => {
    const m = {
      id: MSG,
      payload: {
        partId: '',
        mimeType: 'text/plain',
        headers: [{ name: 'Content-Type', value: 'text/plain; charset=windows-1252' }],
        body: { data: Buffer.from([0x93, 0x68, 0x6f, 0x6c, 0x61, 0x94, 0x20, 0xe9]).toString('base64url') },
      },
    }
    expect(analizarMensaje(m).payload.texto).toBe('“hola” é')
  })

  it('corta un cuerpo gigante y lo avisa', () => {
    const m = {
      id: MSG,
      payload: { partId: '', mimeType: 'text/html', body: { data: b64('x'.repeat(TOPE_CUERPO + 10)) } },
    }
    const { payload } = analizarMensaje(m)
    expect(payload.html).toHaveLength(TOPE_CUERPO)
    expect(payload.truncado).toBe(true)
  })

  it('pide aparte un cuerpo que Gmail no mandó inline', async () => {
    const crudo = {
      id: HILO,
      messages: [{ id: MSG, internalDate: '1', payload: { partId: '', mimeType: 'text/html', body: { attachmentId: 'grande', size: 900000 } } }],
    }
    const pedidos: string[] = []
    const h = await armarHilo(crudo, async (m, a) => {
      pedidos.push(`${m}:${a}`)
      return { data: b64('<b>cuerpo grande</b>'), size: 20 }
    })
    expect(pedidos).toEqual([`${MSG}:grande`])
    expect(h.mensajes[0]?.html).toBe('<b>cuerpo grande</b>')
  })

  it('ordena los mensajes por internalDate', async () => {
    const crudo = {
      id: HILO,
      messages: [
        { id: 'b', internalDate: '2000', payload: { partId: '', mimeType: 'text/plain', body: { data: b64('2') } } },
        { id: 'a', internalDate: '1000', payload: { partId: '', mimeType: 'text/plain', body: { data: b64('1') } } },
      ],
    }
    const h = await armarHilo(crudo, async () => ({ data: '', size: 0 }))
    expect(h.mensajes.map((m) => m.id)).toEqual(['a', 'b'])
  })
})

describe('buscarParte y disposicion', () => {
  it('encuentra la parte por partId y nunca un multipart', () => {
    expect(buscarParte(mensajeFixture(), '2')?.attachmentId).toBe('ANGjdJ-pdf')
    expect(buscarParte(mensajeFixture(), '0')).toBeNull()
    expect(buscarParte(mensajeFixture(), '9')).toBeNull()
  })

  it('un nombre con comillas o saltos de línea no rompe el header', () => {
    const d = disposicion('fac"tura\r\nX-Inyectado: 1.pdf')
    expect(d).not.toMatch(/[\r\n]/)
    expect(d.startsWith('attachment; filename="fac_tura__X-Inyectado: 1.pdf"')).toBe(true)
    expect(disposicion('año.pdf')).toContain("filename*=UTF-8''a%C3%B1o.pdf")
  })

  it('subDelJwt no explota con basura', () => {
    expect(subDelJwt(JWT)).toBe('usuario-1')
    expect(subDelJwt('no.es.jwt')).toBe('desconocido')
  })
})

describe('AutorizadorSupabase', () => {
  const armar = (respuesta: () => Promise<Response>) => {
    const pedidos: Array<{ url: string; headers: Record<string, string> }> = []
    const a = new AutorizadorSupabase('https://base.test', 'clave-publica', async (url, init) => {
      pedidos.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
      return respuesta()
    })
    return { a, pedidos }
  }
  const ok = (filas: unknown) => async () => new Response(JSON.stringify(filas), { status: 200 })

  it('pregunta con el JWT de la persona, filtrando por cuenta Y por hilo', async () => {
    const { a, pedidos } = armar(
      ok([{ account_id: CUENTA, company_id: 'c', gmail_thread_id: HILO, email_accounts: { email_address: 'x@y', active: true } }]),
    )
    const h = await a.autorizarHilo(JWT, CUENTA, HILO)
    expect(h.buzon).toBe('x@y')
    expect(pedidos[0]?.headers['Authorization']).toBe(`Bearer ${JWT}`)
    expect(pedidos[0]?.headers['apikey']).toBe('clave-publica')
    expect(pedidos[0]?.url).toContain(`account_id=eq.${CUENTA}`)
    expect(pedidos[0]?.url).toContain(`gmail_thread_id=eq.${HILO}`)
  })

  it('cero filas (vendedor, otra empresa, anon) es NoEncontrado', async () => {
    await expect(armar(ok([])).a.autorizarHilo(JWT, CUENTA, HILO)).rejects.toBeInstanceOf(NoEncontrado)
  })

  it('una cuenta inactiva es NoEncontrado', async () => {
    const { a } = armar(
      ok([{ account_id: CUENTA, company_id: 'c', gmail_thread_id: HILO, email_accounts: { email_address: 'x@y', active: false } }]),
    )
    await expect(a.autorizarHilo(JWT, CUENTA, HILO)).rejects.toBeInstanceOf(NoEncontrado)
  })

  it('un JWT vencido es NoAutenticado', async () => {
    const { a } = armar(async () => new Response('{}', { status: 401 }))
    await expect(a.autorizarHilo(JWT, CUENTA, HILO)).rejects.toBeInstanceOf(NoAutenticado)
  })

  it('Supabase caído es IndiceNoDisponible, no «no autorizado»', async () => {
    const { a } = armar(async () => {
      throw new Error('ECONNRESET')
    })
    await expect(a.autorizarHilo(JWT, CUENTA, HILO)).rejects.toBeInstanceOf(IndiceNoDisponible)
  })
})

describe('servidor de la bandeja', () => {
  let servidor: Server | null = null
  afterEach(() => {
    servidor?.close()
    servidor = null
  })

  const autorizado: HiloAutorizado = {
    accountId: CUENTA,
    companyId: 'empresa',
    buzon: 'buzon@prueba.invalid',
    gmailThreadId: HILO,
    usuario: 'usuario-1',
  }

  async function levantar(opciones: { autorizador?: Autorizador; limite?: number; buzones?: string[] } = {}) {
    const gmail = new GmailFalso()
    gmail.hilosCompletos.set(HILO, { id: HILO, messages: [mensajeFixture()] })
    gmail.mensajesCompletos.set(MSG, mensajeFixture())
    gmail.mensajesCompletos.set('18f0000000000001', mensajeFixture(OTRO_HILO))
    gmail.adjuntos.set('ANGjdJ-pdf', b64('%PDF-1.4 falso'))
    gmail.adjuntos.set('ANGjdJ-html', b64('<script>alert(1)</script>'))
    const llamadasAutorizador: string[] = []
    const autorizador: Autorizador = opciones.autorizador ?? {
      async autorizarHilo(_jwt, accountId, threadId) {
        llamadasAutorizador.push(`${accountId}:${threadId}`)
        if (threadId !== HILO) throw new NoEncontrado('no visible')
        return autorizado
      },
    }
    servidor = construirServidorApi({
      buzones: new Set(opciones.buzones ?? ['buzon@prueba.invalid']),
      origenes: new Set([ORIGEN]),
      autorizador,
      gmail,
      limitePorMinuto: opciones.limite ?? 100,
    })
    await new Promise<void>((r) => servidor!.listen(0, r))
    const { port } = servidor.address() as AddressInfo
    const pedir = (ruta: string, init: RequestInit = {}) =>
      fetch(`http://127.0.0.1:${port}${ruta}`, {
        ...init,
        headers: { Authorization: `Bearer ${JWT}`, Origin: ORIGEN, ...(init.headers ?? {}) },
      })
    return { gmail, pedir, llamadasAutorizador }
  }

  const rutaHilo = `/gmail/thread?account_id=${CUENTA}&thread_id=${HILO}`
  const rutaAdjunto = (msg: string, part: string) =>
    `/gmail/attachment?account_id=${CUENTA}&thread_id=${HILO}&message_id=${msg}&part_id=${part}`

  it('sin token: 401, y Gmail no se toca', async () => {
    const { pedir, gmail } = await levantar()
    const r = await pedir(rutaHilo, { headers: { Authorization: '' } })
    expect(r.status).toBe(401)
    expect(gmail.llamadas).toEqual([])
  })

  it('un hilo que la RLS no devuelve: 404, y Gmail no se toca', async () => {
    const { pedir, gmail } = await levantar()
    const r = await pedir(`/gmail/thread?account_id=${CUENTA}&thread_id=${OTRO_HILO}`)
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: 'hilo_no_disponible' })
    expect(gmail.llamadas).toEqual([])
  })

  it('ids con forma inválida ni siquiera llegan a la base', async () => {
    const { pedir, llamadasAutorizador } = await levantar()
    const r = await pedir(`/gmail/thread?account_id=x&thread_id=../../profile`)
    expect(r.status).toBe(404)
    expect(llamadasAutorizador).toEqual([])
  })

  it('JWT vencido: 401 sesion_invalida', async () => {
    const { pedir } = await levantar({
      autorizador: { autorizarHilo: () => Promise.reject(new NoAutenticado('401')) },
    })
    const r = await pedir(rutaHilo)
    expect(r.status).toBe(401)
    expect(await r.json()).toEqual({ error: 'sesion_invalida' })
  })

  it('un buzón que la base devuelve pero no está en el allowlist: 404', async () => {
    const { pedir, gmail } = await levantar({ buzones: ['otro@prueba.invalid'] })
    const r = await pedir(rutaHilo)
    expect(r.status).toBe(404)
    expect(gmail.llamadas).toEqual([])
  })

  it('el hilo autorizado vuelve completo, sin caché y con CORS sólo para el origen permitido', async () => {
    const { pedir, gmail } = await levantar()
    const r = await pedir(rutaHilo)
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGEN)
    const h = (await r.json()) as { mensajes: Array<{ asunto: string; adjuntos: unknown[] }> }
    expect(h.mensajes[0]?.asunto).toBe('Pedido de cotización')
    expect(h.mensajes[0]?.adjuntos).toHaveLength(3)
    // Una lectura: nada de modify, watch, send ni trash.
    expect(gmail.llamadas).toEqual([`hiloCompleto:${HILO}`])

    const ajeno = await pedir(rutaHilo, { headers: { Origin: 'https://malicioso.test' } })
    expect(ajeno.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('preflight: 204 para el origen permitido, 403 para otro', async () => {
    const { pedir } = await levantar()
    expect((await pedir(rutaHilo, { method: 'OPTIONS' })).status).toBe(204)
    expect((await pedir(rutaHilo, { method: 'OPTIONS', headers: { Origin: 'https://x.test' } })).status).toBe(403)
  })

  it('las rutas del servicio privado no existen acá', async () => {
    const { pedir } = await levantar()
    for (const ruta of ['/gmail/push', '/gmail/watch', '/gmail/sync', '/gmail/perfil']) {
      expect((await pedir(ruta, { method: 'POST' })).status).toBe(404)
    }
  })

  it('adjunto: baja los bytes con el attachmentId que da Gmail, no el del request', async () => {
    const { pedir, gmail } = await levantar()
    const r = await pedir(`${rutaAdjunto(MSG, '2')}&attachment_id=INVENTADO`)
    expect(r.status).toBe(200)
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe('%PDF-1.4 falso')
    expect(r.headers.get('content-type')).toBe('application/pdf')
    expect(r.headers.get('content-disposition')).toContain('factura.pdf')
    expect(gmail.llamadas).toEqual([`mensajeCompleto:${MSG}`, `adjunto:${MSG}:ANGjdJ-pdf`])
  })

  it('adjunto: un mensaje de OTRO hilo se rechaza antes de bajar nada', async () => {
    const { pedir, gmail } = await levantar()
    const r = await pedir(rutaAdjunto('18f0000000000001', '2'))
    expect(r.status).toBe(404)
    expect(gmail.llamadas.some((l) => l.startsWith('adjunto:'))).toBe(false)
  })

  it('adjunto: una parte inexistente o un multipart es 404', async () => {
    const { pedir } = await levantar()
    expect((await pedir(rutaAdjunto(MSG, '9'))).status).toBe(404)
    expect((await pedir(rutaAdjunto(MSG, '0'))).status).toBe(404)
  })

  it('adjunto: un HTML adjunto se entrega opaco, nunca como text/html', async () => {
    const { pedir } = await levantar()
    const r = await pedir(rutaAdjunto(MSG, '3'))
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/octet-stream')
    expect(r.headers.get('content-security-policy')).toContain('sandbox')
  })

  it('Gmail 429 se traduce en 429 con Retry-After, sin el error crudo', async () => {
    const { pedir, gmail } = await levantar()
    gmail.hiloCompleto = () => Promise.reject(new ErrorGmail(429, 'rateLimitExceeded: detalle interno de Google'))
    const r = await pedir(rutaHilo)
    expect(r.status).toBe(429)
    expect(r.headers.get('retry-after')).toBe('30')
    expect(await r.text()).not.toContain('Google')
  })

  it('Gmail 403 (delegación rota) es 502 gmail_no_autorizado', async () => {
    const { pedir, gmail } = await levantar()
    gmail.hiloCompleto = () => Promise.reject(new ErrorGmail(403, 'x'))
    const r = await pedir(rutaHilo)
    expect(r.status).toBe(502)
    expect(await r.json()).toEqual({ error: 'gmail_no_autorizado' })
  })

  it('un hilo borrado en Gmail entre el índice y la apertura es 404', async () => {
    const { pedir, gmail } = await levantar()
    gmail.hilosCompletos.clear()
    gmail.hilos.clear()
    expect((await pedir(rutaHilo)).status).toBe(404)
  })

  it('corta un loop del frontend: 429 al pasar el límite por persona', async () => {
    const { pedir } = await levantar({ limite: 2 })
    expect((await pedir(rutaHilo)).status).toBe(200)
    expect((await pedir(rutaHilo)).status).toBe(200)
    expect((await pedir(rutaHilo)).status).toBe(429)
  })
})
