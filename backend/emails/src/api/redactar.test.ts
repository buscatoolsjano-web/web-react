/**
 * Redactar, responder, reenviar, borradores y envío — contra un Gmail falso.
 *
 * Lo que más importa acá, y se mide contando llamadas al proveedor y no filas:
 *
 *   · diez envíos simultáneos con el mismo client_request_id → UN envío a Gmail;
 *   · un resultado incierto NUNCA se reenvía: se reconcilia buscando en SENT la
 *     cabecera X-BT-Request-Id (Gmail REEMPLAZA el Message-ID: el falso también);
 *   · ni un CR/LF del usuario llega a una cabecera;
 *   · ni una etiqueta HTML del usuario llega como marcado.
 */
import { describe, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { GmailFalso, RegistroMemoria } from '../pruebas/dobles.js'
import { cabecera, decodificarPalabras, leerMime, type ParteLeida } from '../pruebas/mimeLector.js'
import { NoEncontrado, type Autorizador } from './autorizacion.js'
import { construirMime, direccionValida, MimeInvalido, nombreArchivo } from './mime.js'
import { htmlATexto, referencias, textoAHtml } from './redaccion.js'
import {
  DatosInvalidos,
  descartarBorrador,
  enviar,
  guardarBorrador,
  LIMITES,
  listarBorradores,
  obtenerBorradorEditable,
  type ContextoRedactar,
} from './redactar.js'
import { firmar } from './registro.js'

const CUENTA = '11111111-1111-4111-8111-111111111111'
const BUZON = 'info@empresa.test'
const HILO = '1a0000000000aa01'
const HILO_AJENO = '1a0000000000bb02'
const MSG = '1a0000000000aa11'
const MSG_AJENO = '1a0000000000bb22'
const JWT = 'a.b.c'

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url')

function mensajeOriginal(id = MSG, threadId = HILO) {
  return {
    id,
    threadId,
    labelIds: ['INBOX', 'UNREAD'],
    internalDate: '1757700000000',
    payload: {
      partId: '',
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'Cliente <cliente@ejemplo.test>' },
        { name: 'To', value: 'info@empresa.test' },
        { name: 'Cc', value: 'compras@ejemplo.test' },
        { name: 'Subject', value: 'Pedido de cotización' },
        { name: 'Message-ID', value: '<orig-1@ejemplo.test>' },
        { name: 'References', value: '<antes-0@ejemplo.test>' },
      ],
      parts: [
        { partId: '0', mimeType: 'text/plain', headers: [], body: { size: 10, data: b64('Necesito 3 llaves.\nGracias') } },
        {
          partId: '1',
          mimeType: 'application/pdf',
          filename: 'planilla.pdf',
          headers: [{ name: 'Content-Disposition', value: 'attachment; filename="planilla.pdf"' }],
          body: { attachmentId: 'att-planilla', size: 9 },
        },
      ],
    },
  }
}

function armar(opciones: { autorizador?: Autorizador; buzones?: string[] } = {}) {
  const gmail = new GmailFalso()
  gmail.mensajesCompletos.set(MSG, mensajeOriginal())
  gmail.mensajesCompletos.set(MSG_AJENO, mensajeOriginal(MSG_AJENO, HILO_AJENO))
  gmail.adjuntos.set('att-planilla', b64('%PDF-1.4x'))
  const registro = new RegistroMemoria()
  const autorizaciones: string[] = []
  const autorizador: Autorizador = opciones.autorizador ?? {
    async autorizarCuenta(_jwt, accountId) {
      autorizaciones.push(`cuenta:${accountId}`)
      if (accountId !== CUENTA) throw new NoEncontrado('otra cuenta')
      return { accountId, companyId: 'empresa', buzon: BUZON, nombre: 'Empresa · info@', usuario: 'usuario-1' }
    },
    async autorizarHilo(_jwt, accountId, threadId) {
      autorizaciones.push(`hilo:${threadId}`)
      if (threadId !== HILO) throw new NoEncontrado('hilo no visible')
      return { accountId, companyId: 'empresa', buzon: BUZON, gmailThreadId: threadId, usuario: 'usuario-1' }
    },
  }
  const ctx: ContextoRedactar = { buzones: new Set(opciones.buzones ?? [BUZON]), autorizador, gmail, registro }
  return { ctx, gmail, registro, autorizaciones }
}

const base = (extra: Record<string, unknown> = {}) => ({
  account_id: CUENTA,
  modo: 'nuevo',
  para: ['destino@cliente.test'],
  cc: [],
  cco: [],
  asunto: 'Presupuesto',
  texto: 'Hola,\n\nadjunto el presupuesto.',
  adjuntos: [],
  ...extra,
})

function partes(raw: Buffer): ParteLeida[] {
  const salida: ParteLeida[] = []
  const recorrer = (p: ParteLeida) => {
    salida.push(p)
    for (const h of p.parts ?? []) recorrer(h)
  }
  recorrer(leerMime(raw, () => 'x').payload)
  return salida
}
const cuerpo = (raw: Buffer, mime: string) => {
  const p = partes(raw).find((x) => x.mimeType === mime && !x.filename)
  return p?.body.data ? Buffer.from(p.body.data, 'base64url').toString('utf8') : null
}
const lineasCabecera = (raw: Buffer) => raw.toString('utf8').split('\r\n\r\n')[0]!.split('\r\n')

// ═══════════════════════════════════════════════════════════════════════════
describe('MIME', () => {
  const minimo = {
    de: { direccion: BUZON, nombre: 'Empresa' },
    para: [{ direccion: 'a@b.test' }],
    cc: [],
    cco: [],
    asunto: 'Cotización ñandú — año 2026',
    messageId: '<bt.x@empresa.test>',
    texto: 'hola',
    html: '<p>hola</p>',
    adjuntos: [],
  }

  it('CRLF, MIME-Version, multipart/alternative con texto y HTML', () => {
    const raw = construirMime(minimo)
    const txt = raw.toString('utf8')
    expect(txt).not.toMatch(/[^\r]\n/)
    expect(cabecera(raw, 'MIME-Version')).toBe('1.0')
    expect(cabecera(raw, 'Content-Type')).toMatch(/^multipart\/alternative; boundary="/)
    expect(cuerpo(raw, 'text/plain')).toBe('hola')
    expect(cuerpo(raw, 'text/html')).toBe('<p>hola</p>')
  })

  it('un asunto no ASCII va en encoded-words y vuelve igual', () => {
    const raw = construirMime(minimo)
    expect(cabecera(raw, 'Subject')).toMatch(/^=\?UTF-8\?B\?/)
    expect(decodificarPalabras(cabecera(raw, 'Subject'))).toBe(minimo.asunto)
    for (const l of lineasCabecera(raw)) expect(l.length).toBeLessThanOrEqual(998)
  })

  it('con adjuntos: multipart/mixed, bytes idénticos y nombre legible', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 13, 10, 13, 10])
    const raw = construirMime({ ...minimo, adjuntos: [{ nombre: 'Factura Nº 12 — año.pdf', mime: 'application/pdf', bytes }] })
    expect(cabecera(raw, 'Content-Type')).toMatch(/^multipart\/mixed/)
    const adj = partes(raw).find((p) => p.filename)!
    expect(adj.filename).toBe('Factura Nº 12 — año.pdf')
    const leidos: Buffer[] = []
    leerMime(raw, (_p, b) => {
      leidos.push(b)
      return 'x'
    })
    expect(createHash('sha256').update(leidos[0]!).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('INYECCIÓN: un CR/LF en el asunto no crea una cabecera Bcc', () => {
    const raw = construirMime({ ...minimo, asunto: 'Hola\r\nBcc: espia@evil.test\r\n\r\ncuerpo falso' })
    const lineas = lineasCabecera(raw)
    expect(lineas.some((l) => /^bcc:/i.test(l))).toBe(false)
    expect(raw.toString('utf8')).not.toContain('espia@evil.test\r\n')
  })

  it('INYECCIÓN: un nombre visible con CR/LF se aplana', () => {
    const raw = construirMime({ ...minimo, de: { direccion: BUZON, nombre: 'Empresa\r\nBcc: x@evil.test' } })
    expect(lineasCabecera(raw).some((l) => /^bcc:/i.test(l))).toBe(false)
  })

  it('INYECCIÓN: una dirección con CR/LF, coma o <> se rechaza', () => {
    for (const d of ['a@b.test\r\nBcc: x@evil.test', 'a@b.test,x@evil.test', '<a@b.test>', 'a b@c.test']) {
      expect(() => construirMime({ ...minimo, para: [{ direccion: d }] })).toThrow(MimeInvalido)
    }
  })

  it('INYECCIÓN: nombre de archivo y tipo MIME raros no rompen las cabeceras', () => {
    const raw = construirMime({
      ...minimo,
      adjuntos: [{ nombre: 'a"\r\nContent-Type: text/html\r\n\r\n<script>.pdf', mime: 'text/plain\r\nX-Evil: 1', bytes: Buffer.from('x') }],
    })
    const txt = raw.toString('utf8')
    expect(txt).not.toMatch(/\r\nX-Evil:/)
    expect(txt).not.toMatch(/\r\nContent-Type: text\/html\r\n\r\n<script>/)
    expect(partes(raw).find((p) => p.filename)!.mimeType).toBe('application/octet-stream')
    expect(nombreArchivo('../../etc/passwd')).toBe('.._.._etc_passwd')
  })

  it('direcciones razonables: acepta lo raro válido, rechaza lo obvio inválido', () => {
    for (const d of ['nombre+etiqueta@sub.dominio.com.ar', "o'brien@ejemplo.museum", 'a_b-c.d@x-y.io']) {
      expect(direccionValida(d)).toBe(true)
    }
    for (const d of ['', 'a@b', '@b.com', 'a@', 'a..b@c.com', 'a@-b.com', 'a@b..com', 'x'.repeat(65) + '@b.com']) {
      expect(direccionValida(d)).toBe(false)
    }
  })

  it('References: el Message-ID original al final, sin duplicados y acotado', () => {
    expect(referencias('<c@x>', '<a@x> <b@x> <c@x>')).toEqual({ inReplyTo: '<c@x>', references: '<a@x> <b@x> <c@x>' })
    const muchas = Array.from({ length: 40 }, (_, i) => `<r${i}@x>`).join(' ')
    expect(referencias('<fin@x>', muchas).references!.split(' ')).toHaveLength(20)
    expect(referencias('no-es-un-id', '')).toEqual({ inReplyTo: null, references: null })
  })
})

describe('HTML saliente', () => {
  it('INYECCIÓN: script, onerror, javascript:, svg, iframe y form viajan como texto escapado', () => {
    const hostil =
      '<script>alert(1)</script> <img src=x onerror=alert(1)> <a href="javascript:alert(1)">x</a> ' +
      '<svg onload=alert(1)> <iframe src=https://evil.test> <form action=https://evil.test>'
    const html = textoAHtml(hostil)
    expect(html).not.toMatch(/<(script|img|svg|iframe|form)\b/i)
    expect(html).not.toMatch(/<a href="javascript:/i)
    expect(html).toContain('&lt;script&gt;')
    // «onerror=alert(1)» puede aparecer como TEXTO visible; lo que no puede haber
    // es un atributo on* dentro de una etiqueta real.
    expect(html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i)
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('enlaza sólo http/https, y no se lleva la puntuación final', () => {
    const html = textoAHtml('Ver https://buscatools.com.ar/precios. Y ftp://x.test o data:text/html,hola')
    expect(html).toContain('<a href="https://buscatools.com.ar/precios">')
    expect(html).not.toContain('href="ftp:')
    expect(html).not.toContain('href="data:')
  })

  it('htmlATexto saca marcado y decodifica entidades para citar', () => {
    expect(htmlATexto('<p>Hola&nbsp;<b>Juan</b></p><script>x</script><div>&lt;chau&gt;</div>')).toBe('Hola Juan\n<chau>')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('responder, responder a todos, reenviar', () => {
  it('RESPONDER: mismo hilo, In-Reply-To, References, asunto «Re:» y cita del original', async () => {
    const { ctx, gmail } = armar()
    const r = await enviar(ctx, JWT, {
      ...base({ modo: 'responder', thread_id: HILO, ref_message_id: MSG, asunto: 'Otro asunto que se ignora' }),
      para: ['cliente@ejemplo.test'],
      client_request_id: randomUUID(),
    })
    expect(r.estado).toBe('enviado')
    const env = gmail.enviados[0]!
    expect(env.threadId).toBe(HILO)
    expect(cabecera(env.raw, 'In-Reply-To')).toBe('<orig-1@ejemplo.test>')
    expect(cabecera(env.raw, 'References')).toBe('<antes-0@ejemplo.test> <orig-1@ejemplo.test>')
    expect(decodificarPalabras(cabecera(env.raw, 'Subject'))).toBe('Re: Pedido de cotización')
    expect(cuerpo(env.raw, 'text/plain')).toMatch(/adjunto el presupuesto\.\n\nEl .* escribió:\n> Necesito 3 llaves\.\n> Gracias$/)
    expect(cabecera(env.raw, 'X-BT-Compose')).toBe('')
  })

  it('un From, Reply-To, cabeceras o raw elegidos por el cliente: rechazados antes de la base y de Gmail', async () => {
    const { ctx, gmail, registro, autorizaciones } = armar()
    for (const extra of [{ from: 'ceo@otra.test' }, { de: 'ceo@otra.test' }, { reply_to: 'x@evil.test' }, { headers: { Bcc: 'x@evil.test' } }, { raw: 'Zm9v' }]) {
      await expect(enviar(ctx, JWT, { ...base(), ...extra, client_request_id: randomUUID() })).rejects.toBeInstanceOf(DatosInvalidos)
      await expect(guardarBorrador(ctx, JWT, { ...base(), ...extra })).rejects.toBeInstanceOf(DatosInvalidos)
    }
    await expect(enviar(ctx, JWT, { ...base({ adjuntos: [{ tipo: 'nuevo', nombre: 'a.txt', mime: 'text/plain', datos: 'aG9sYQ', headers: 'Bcc: x' }] }), client_request_id: randomUUID() })).rejects.toBeInstanceOf(DatosInvalidos)
    expect(gmail.enviados.length + gmail.conteo.crearBorrador).toBe(0)
    expect(registro.filas.size).toBe(0)
    expect(autorizaciones).toHaveLength(0)
  })

  it('el From es SIEMPRE la cuenta autorizada', async () => {
    const { ctx, gmail } = armar()
    await enviar(ctx, JWT, { ...base(), client_request_id: randomUUID() })
    expect(decodificarPalabras(cabecera(gmail.enviados[0]!.raw, 'From'))).toBe('Empresa · info@ <info@empresa.test>')
    expect(cabecera(gmail.enviados[0]!.raw, 'From')).toMatch(/<info@empresa\.test>$/)
  })

  it('RESPONDER A TODOS: una dirección repetida entre campos va una sola vez', async () => {
    const { ctx, gmail } = armar()
    await enviar(ctx, JWT, {
      ...base({ modo: 'responder_todos', thread_id: HILO, ref_message_id: MSG }),
      para: ['cliente@ejemplo.test', 'CLIENTE@ejemplo.test '],
      cc: ['compras@ejemplo.test', 'cliente@ejemplo.test'],
      cco: ['compras@ejemplo.test'],
      client_request_id: randomUUID(),
    })
    const raw = gmail.enviados[0]!.raw
    expect(cabecera(raw, 'To')).toBe('cliente@ejemplo.test')
    expect(cabecera(raw, 'Cc')).toBe('compras@ejemplo.test')
    expect(cabecera(raw, 'Bcc')).toBe('')
  })

  it('REENVIAR: hilo nuevo, sin In-Reply-To, encabezado del original y adjunto original opcional', async () => {
    const { ctx, gmail } = armar()
    await enviar(ctx, JWT, {
      ...base({ modo: 'reenviar', thread_id: HILO, ref_message_id: MSG, asunto: '' }),
      adjuntos: [{ tipo: 'original', message_id: MSG, part_id: '1' }],
      client_request_id: randomUUID(),
    })
    const env = gmail.enviados[0]!
    expect(env.threadId).not.toBe(HILO)
    expect(cabecera(env.raw, 'In-Reply-To')).toBe('')
    expect(decodificarPalabras(cabecera(env.raw, 'Subject'))).toBe('Fwd: Pedido de cotización')
    const texto = cuerpo(env.raw, 'text/plain')!
    expect(texto).toContain('---------- Mensaje reenviado ----------')
    expect(texto).toMatch(/De: Cliente <cliente@ejemplo\.test>\nFecha: .+\nAsunto: Pedido de cotización\nPara: info@empresa\.test\nCc: compras@ejemplo\.test/)
    const adj = partes(env.raw).find((p) => p.filename === 'planilla.pdf')
    expect(adj).toBeDefined()
  })

  it('un mensaje de OTRO hilo como referencia: rechazado y 0 envíos', async () => {
    const { ctx, gmail, registro } = armar()
    await expect(
      enviar(ctx, JWT, { ...base({ modo: 'responder', thread_id: HILO_AJENO, ref_message_id: MSG_AJENO }), client_request_id: randomUUID() }),
    ).rejects.toBeInstanceOf(NoEncontrado)
    await expect(
      enviar(ctx, JWT, { ...base({ modo: 'responder', thread_id: HILO, ref_message_id: MSG_AJENO }), client_request_id: randomUUID() }),
    ).rejects.toBeInstanceOf(NoEncontrado)
    expect(gmail.conteo.enviarMensaje).toBe(0)
    // El hilo ajeno no deja ni una reserva; el mensaje de otro hilo, sólo una fallida.
    expect([...registro.filas.values()].filter((f) => f.status !== 'fallido')).toHaveLength(0)
  })

  it('un adjunto «original» de un mensaje que no es el referenciado: rechazado', async () => {
    const { ctx, gmail } = armar()
    await expect(
      enviar(ctx, JWT, {
        ...base({ modo: 'reenviar', thread_id: HILO, ref_message_id: MSG }),
        adjuntos: [{ tipo: 'original', message_id: MSG_AJENO, part_id: '1' }],
        client_request_id: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(DatosInvalidos)
    expect(gmail.conteo.enviarMensaje).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('autorización y validación antes de tocar nada', () => {
  it('una cuenta que la RLS no devuelve (vendedor, otra empresa): 0 reservas, 0 envíos', async () => {
    const { ctx, gmail, registro } = armar()
    await expect(enviar(ctx, JWT, { ...base({ account_id: '22222222-2222-4222-8222-222222222222' }), client_request_id: randomUUID() }))
      .rejects.toBeInstanceOf(NoEncontrado)
    expect(registro.filas.size).toBe(0)
    expect(gmail.conteo.enviarMensaje).toBe(0)
  })

  it('un buzón fuera del allowlist: 0 envíos', async () => {
    const { ctx, gmail } = armar({ buzones: ['otro@empresa.test'] })
    await expect(enviar(ctx, JWT, { ...base(), client_request_id: randomUUID() })).rejects.toBeInstanceOf(NoEncontrado)
    expect(gmail.conteo.enviarMensaje).toBe(0)
  })

  it('sin destinatarios, dirección inválida, client_request_id inválido, CR/LF en el asunto o adjunto inválido: DatosInvalidos, 0 reservas, 0 Gmail', async () => {
    const { ctx, registro, gmail } = armar()
    await expect(enviar(ctx, JWT, { ...base({ para: [] }), client_request_id: randomUUID() })).rejects.toBeInstanceOf(DatosInvalidos)
    await expect(enviar(ctx, JWT, { ...base({ para: ['x@y.test\r\nBcc: z@evil.test'] }), client_request_id: randomUUID() })).rejects.toBeInstanceOf(DatosInvalidos)
    await expect(enviar(ctx, JWT, { ...base(), client_request_id: 'no-uuid' })).rejects.toBeInstanceOf(DatosInvalidos)
    for (const asunto of ['Hola\r\nBcc: x@evil.test', 'Hola\nX-Evil: 1', 'Hola\u0000']) {
      await expect(enviar(ctx, JWT, { ...base({ asunto }), client_request_id: randomUUID() })).rejects.toBeInstanceOf(DatosInvalidos)
    }
    for (const adjuntos of [[{ tipo: 'nuevo', nombre: 'a', mime: 'text/plain', datos: '<<no base64>>' }], [{ tipo: 'otro' }], [{ tipo: 'original', message_id: 'zz', part_id: '1' }], ['texto'], Array.from({ length: 21 }, () => ({ tipo: 'nuevo', nombre: 'a', mime: 'text/plain', datos: 'aA' }))]) {
      await expect(enviar(ctx, JWT, { ...base({ adjuntos }), client_request_id: randomUUID() })).rejects.toBeInstanceOf(DatosInvalidos)
    }
    await expect(enviar(ctx, JWT, ['no', 'objeto'])).rejects.toBeInstanceOf(DatosInvalidos)
    expect(gmail.enviados.length).toBe(0)
    expect(registro.filas.size).toBe(0)
  })

  it('adjuntos por encima del límite: fallido, sin envío', async () => {
    const { ctx, gmail, registro } = armar()
    const grande = Buffer.alloc(LIMITES.bytesAdjuntos + 1).toString('base64')
    await expect(
      enviar(ctx, JWT, { ...base({ adjuntos: [{ tipo: 'nuevo', nombre: 'g.bin', mime: 'application/octet-stream', datos: grande }] }), client_request_id: randomUUID() }),
    ).rejects.toBeInstanceOf(DatosInvalidos)
    expect(gmail.conteo.enviarMensaje).toBe(0)
    expect([...registro.filas.values()][0]!.status).toBe('fallido')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('idempotencia y concurrencia del envío', () => {
  it('DIEZ requests simultáneos con el mismo client_request_id → UN envío a Gmail', async () => {
    const { ctx, gmail, registro } = armar()
    gmail.demoraEnvioMs = 30
    const crid = randomUUID()
    const resultados = await Promise.all(Array.from({ length: 10 }, () => enviar(ctx, JWT, { ...base(), client_request_id: crid })))
    expect(gmail.conteo.enviarMensaje).toBe(1)
    expect(gmail.enviados).toHaveLength(1)
    expect(resultados.filter((r) => r.estado === 'enviado' && !r.repetido)).toHaveLength(1)
    expect(resultados.every((r) => r.estado === 'enviado' || r.estado === 'en_curso')).toBe(true)
    expect(registro.eventos.filter((e) => e.accion === 'email_enviado')).toHaveLength(1)
  })

  it('reintentar un envío ya hecho devuelve el mismo resultado sin volver a llamar a Gmail', async () => {
    const { ctx, gmail } = armar()
    const crid = randomUUID()
    const a = await enviar(ctx, JWT, { ...base(), client_request_id: crid })
    const b = await enviar(ctx, JWT, { ...base(), client_request_id: crid })
    expect(gmail.conteo.enviarMensaje).toBe(1)
    expect(b).toEqual({ ...a, repetido: true })
  })

  it('A · Message-ID REEMPLAZADO por Gmail + X-BT-Request-Id conservado → el reintento RECONCILIA sin reenviar', async () => {
    const { ctx, gmail, registro } = armar()
    const crid = randomUUID()
    gmail.falloEnvio = 'aceptado_incierto'
    expect(await enviar(ctx, JWT, { ...base(), client_request_id: crid })).toEqual({ estado: 'incierto', motivo: 'resultado_perdido' })
    expect(gmail.enviados).toHaveLength(1)
    // Lo que guardó Gmail: otro Message-ID, y la cabecera propia con el request id.
    expect(cabecera(gmail.enviados[0]!.raw, 'Message-ID')).toMatch(/@mail\.gmail\.com>$/)
    expect(cabecera(gmail.enviados[0]!.raw, 'Message-ID')).not.toContain(crid)
    expect(cabecera(gmail.enviados[0]!.raw, 'X-BT-Request-Id')).toBe(crid)
    const r = await enviar(ctx, JWT, { ...base(), client_request_id: crid })
    expect(r).toEqual({ estado: 'enviado', gmail_message_id: gmail.enviados[0]!.id, gmail_thread_id: gmail.enviados[0]!.threadId, repetido: true })
    expect(gmail.conteo.enviarMensaje).toBe(1)
    expect(gmail.enviados).toHaveLength(1)
    expect([...registro.filas.values()][0]).toMatchObject({ status: 'enviado', messageId: gmail.enviados[0]!.id })
    expect(registro.eventos.filter((e) => e.accion === 'email_enviado')).toHaveLength(1)
  })

  it('el request id viaja SÓLO en X-BT-Request-Id: el Message-ID que mandamos ya no lo lleva, y un borrador no lleva la cabecera', async () => {
    const { ctx, gmail } = armar()
    gmail.reemplazaMessageId = false // para ver exactamente lo que armó el servidor
    const crid = randomUUID()
    await enviar(ctx, JWT, { ...base(), client_request_id: crid })
    const raw = gmail.enviados[0]!.raw
    expect(cabecera(raw, 'X-BT-Request-Id')).toBe(crid)
    expect(cabecera(raw, 'Message-ID')).not.toContain(crid)
    expect(cabecera(raw, 'X-BT-Compose')).toBeFalsy()
    const g = await guardarBorrador(ctx, JWT, base({ texto: 'borrador' }))
    expect(cabecera(gmail.borradores.get(g.draft_id)!.raw, 'X-BT-Request-Id')).toBeFalsy()
  })

  it('B · Gmail NO conserva X-BT-Request-Id → queda incierto (sin_coincidencia), aunque el mail esté en SENT; nunca reenvía', async () => {
    const { ctx, gmail, registro } = armar()
    gmail.conservaCabecerasPropias = false
    const crid = randomUUID()
    gmail.falloEnvio = 'aceptado_incierto'
    await enviar(ctx, JWT, { ...base(), client_request_id: crid })
    expect(gmail.enviados).toHaveLength(1)
    for (let i = 0; i < 3; i++) {
      expect(await enviar(ctx, JWT, { ...base(), client_request_id: crid })).toEqual({ estado: 'incierto', motivo: 'sin_coincidencia' })
    }
    expect(gmail.conteo.enviarMensaje).toBe(1)
    // Mismo hilo, mismo destinatario, misma hora: NO alcanza para cerrarlo.
    expect([...registro.filas.values()][0]!.status).toBe('incierto')
    expect(registro.eventos).toHaveLength(0)
  })

  it('C · DOS mensajes en SENT con el mismo request id → incierto, conflicto registrado, no elige ninguno', async () => {
    const { ctx, gmail, registro } = armar()
    const crid = randomUUID()
    gmail.falloEnvio = 'aceptado_incierto'
    await enviar(ctx, JWT, { ...base(), client_request_id: crid })
    gmail.duplicarEnviado(gmail.enviados[0]!.id)
    expect(await enviar(ctx, JWT, { ...base(), client_request_id: crid })).toEqual({ estado: 'incierto', motivo: 'conflicto' })
    const fila = [...registro.filas.values()][0]!
    expect(fila).toMatchObject({ status: 'incierto', messageId: null, error: 'conflicto_request_id:2' })
    expect(registro.eventos).toHaveLength(0)
    expect(gmail.conteo.enviarMensaje).toBe(1)
  })

  it('la búsqueda no revisó toda la ventana, o Gmail no respondió → incierto con su motivo, sin tocar la fila', async () => {
    const { ctx, gmail, registro } = armar()
    const crid = randomUUID()
    gmail.falloEnvio = 'aceptado_incierto'
    await enviar(ctx, JWT, { ...base(), client_request_id: crid })
    gmail.busquedaIncompleta = true
    expect(await enviar(ctx, JWT, { ...base(), client_request_id: crid })).toEqual({ estado: 'incierto', motivo: 'busqueda_incompleta' })
    gmail.busquedaIncompleta = false
    gmail.falloBusqueda = true
    expect(await enviar(ctx, JWT, { ...base(), client_request_id: crid })).toEqual({ estado: 'incierto', motivo: 'busqueda_fallida' })
    expect([...registro.filas.values()][0]!.status).toBe('incierto')
    gmail.falloBusqueda = false
    expect((await enviar(ctx, JWT, { ...base(), client_request_id: crid })).estado).toBe('enviado')
    expect(gmail.conteo.enviarMensaje).toBe(1)
  })

  it('la ventana es alrededor del ÚLTIMO intento: un mensaje con el mismo request id pero fuera de la ventana no cuenta', async () => {
    const { ctx, gmail } = armar()
    const crid = randomUUID()
    let t = Date.now()
    gmail.reloj = () => t
    gmail.falloEnvio = 'aceptado_incierto'
    await enviar(ctx, JWT, { ...base(), client_request_id: crid })
    // El mensaje figura como enviado mucho antes del intento (reloj de Gmail corrido): fuera de la ventana.
    gmail.enviados[0]!.fecha = Date.now() - LIMITES.reconciliarAntesMs - 60_000
    expect(await enviar(ctx, JWT, { ...base(), client_request_id: crid })).toEqual({ estado: 'incierto', motivo: 'sin_coincidencia' })
    t = Date.now()
    gmail.enviados[0]!.fecha = t
    expect((await enviar(ctx, JWT, { ...base(), client_request_id: crid })).estado).toBe('enviado')
  })

  it('D · por borrador: incierto en drafts.send → los reintentos reconcilian o esperan, NUNCA vuelven a mandar', async () => {
    const { ctx, gmail } = armar()
    const g = await guardarBorrador(ctx, JWT, base({ texto: 'desde borrador' }))
    const crid = randomUUID()
    gmail.falloEnvio = 'incierto_sin_envio'
    expect(await enviar(ctx, JWT, { ...base({ texto: 'desde borrador' }), draft_id: g.draft_id, client_request_id: crid })).toEqual({ estado: 'incierto', motivo: 'resultado_perdido' })
    for (let i = 0; i < 5; i++) {
      expect(await enviar(ctx, JWT, { ...base({ texto: 'desde borrador' }), draft_id: g.draft_id, client_request_id: crid })).toEqual({ estado: 'incierto', motivo: 'sin_coincidencia' })
    }
    expect(gmail.conteo.enviarBorrador + gmail.conteo.enviarMensaje).toBe(1)
    expect(gmail.enviados).toHaveLength(0)
  })

  it('el pedido se cortó ANTES de que Gmail lo procesara: sigue incierto y NUNCA se reenvía solo', async () => {
    const { ctx, gmail } = armar()
    const crid = randomUUID()
    gmail.falloEnvio = 'incierto_sin_envio'
    expect(await enviar(ctx, JWT, { ...base(), client_request_id: crid })).toEqual({ estado: 'incierto', motivo: 'resultado_perdido' })
    expect(await enviar(ctx, JWT, { ...base(), client_request_id: crid })).toEqual({ estado: 'incierto', motivo: 'sin_coincidencia' })
    expect(gmail.conteo.enviarMensaje).toBe(1)
    expect(gmail.enviados).toHaveLength(0)
  })

  it('una reserva abandonada (proceso muerto) se trata como incierta, no se reenvía', async () => {
    const { ctx, gmail, registro } = armar()
    const crid = randomUUID()
    await registro.reservar(JWT, 'usuario-1', CUENTA, crid, 'nuevo')
    expect(await enviar(ctx, JWT, { ...base(), client_request_id: crid })).toEqual({ estado: 'en_curso' })
    registro.envejecer(LIMITES.reservaVencidaMs + 1000)
    expect(await enviar(ctx, JWT, { ...base(), client_request_id: crid })).toEqual({ estado: 'incierto', motivo: 'sin_coincidencia' })
    expect([...registro.filas.values()][0]).toMatchObject({ status: 'incierto', error: 'reserva_vencida' })
    expect(gmail.conteo.enviarMensaje).toBe(0)
  })

  it('una fila «fallido» re-reservada mucho después: la vencida se cuenta desde el ÚLTIMO intento, no desde la creación', async () => {
    const { ctx, gmail, registro } = armar()
    const crid = randomUUID()
    gmail.falloEnvio = '429'
    await expect(enviar(ctx, JWT, { ...base(), client_request_id: crid })).rejects.toMatchObject({ status: 429 })
    registro.envejecer(3 * 3600_000) // la fila se creó hace 3 horas
    // Un doble click: el primero re-reserva (intento nuevo) y se demora en Gmail; el segundo ve «reservado».
    gmail.demoraEnvioMs = 50
    const [a, b] = await Promise.all([
      enviar(ctx, JWT, { ...base(), client_request_id: crid }),
      new Promise<Awaited<ReturnType<typeof enviar>>>((ok) => setTimeout(() => ok(enviar(ctx, JWT, { ...base(), client_request_id: crid })), 5)),
    ])
    expect(a.estado).toBe('enviado')
    expect(b).toEqual({ estado: 'en_curso' })
    expect(gmail.conteo.enviarMensaje).toBe(2) // el 429 y el envío real
    expect(gmail.enviados).toHaveLength(1)
  })

  it('429: Gmail no lo aceptó → fallido → el reintento con el MISMO id sí envía, una vez', async () => {
    const { ctx, gmail } = armar()
    const crid = randomUUID()
    gmail.falloEnvio = '429'
    await expect(enviar(ctx, JWT, { ...base(), client_request_id: crid })).rejects.toMatchObject({ status: 429 })
    const r = await enviar(ctx, JWT, { ...base(), client_request_id: crid })
    expect(r.estado).toBe('enviado')
    expect(gmail.enviados).toHaveLength(1)
  })

  it('400 de Gmail: fallido con un código propio, sin el error crudo', async () => {
    const { ctx, gmail } = armar()
    gmail.falloEnvio = '400'
    expect(await enviar(ctx, JWT, { ...base(), client_request_id: randomUUID() })).toEqual({ estado: 'fallido', error: 'gmail_rechazo' })
  })

  it('otra persona con el mismo client_request_id: rechazado', async () => {
    const { ctx, registro } = armar()
    const crid = randomUUID()
    await registro.reservar(JWT, 'otra-persona', CUENTA, crid, 'nuevo')
    await expect(enviar(ctx, JWT, { ...base(), client_request_id: crid })).rejects.toBeInstanceOf(NoEncontrado)
  })

  it('límite de envíos por persona: 429 antes de tocar Gmail', async () => {
    const { ctx, gmail, registro } = armar()
    registro.limitePorUsuario = 2
    await enviar(ctx, JWT, { ...base(), client_request_id: randomUUID() })
    await enviar(ctx, JWT, { ...base(), client_request_id: randomUUID() })
    await expect(enviar(ctx, JWT, { ...base(), client_request_id: randomUUID() })).rejects.toMatchObject({ name: 'LimiteEnvios' })
    expect(gmail.conteo.enviarMensaje).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('borradores de Gmail', () => {
  it('crear y después actualizar: el MISMO borrador, sin crear otro', async () => {
    const { ctx, gmail } = armar()
    const a = await guardarBorrador(ctx, JWT, base({ texto: 'primera versión' }))
    const b = await guardarBorrador(ctx, JWT, base({ texto: 'segunda versión', draft_id: a.draft_id }))
    expect(b.draft_id).toBe(a.draft_id)
    expect(gmail.conteo.crearBorrador).toBe(1)
    expect(gmail.borradores.size).toBe(1)
    expect(cuerpo(gmail.borradores.get(a.draft_id)!.raw, 'text/plain')).toBe('segunda versión')
  })

  it('un borrador SIN destinatarios se guarda (Gmail lo permite); enviarlo así, no', async () => {
    const { ctx, gmail, registro } = armar()
    const r = await guardarBorrador(ctx, JWT, base({ para: [], texto: 'todavía no sé a quién' }))
    expect(gmail.borradores.has(r.draft_id)).toBe(true)
    const raw = gmail.borradores.get(r.draft_id)!.raw
    expect(cabecera(raw, 'To')).toBeFalsy()
    await expect(enviar(ctx, JWT, base({ para: [], draft_id: r.draft_id, client_request_id: randomUUID() }))).rejects.toBeInstanceOf(DatosInvalidos)
    expect(gmail.conteo.enviarBorrador + gmail.conteo.enviarMensaje).toBe(0)
    expect(registro.filas.size).toBe(0)
  })

  it('dos actualizaciones simultáneas del mismo borrador: un borrador, el último write', async () => {
    const { ctx, gmail } = armar()
    const a = await guardarBorrador(ctx, JWT, base({ texto: 'v0' }))
    await Promise.all([
      guardarBorrador(ctx, JWT, base({ texto: 'v1', draft_id: a.draft_id })),
      guardarBorrador(ctx, JWT, base({ texto: 'v2', draft_id: a.draft_id })),
    ])
    expect(gmail.borradores.size).toBe(1)
    expect(gmail.conteo.crearBorrador).toBe(1)
    expect(['v1', 'v2']).toContain(cuerpo(gmail.borradores.get(a.draft_id)!.raw, 'text/plain'))
  })

  it('un borrador borrado fuera del ERP: se recrea y se avisa, sin romper', async () => {
    const { ctx, gmail } = armar()
    const a = await guardarBorrador(ctx, JWT, base())
    gmail.borradores.clear()
    const b = await guardarBorrador(ctx, JWT, base({ draft_id: a.draft_id }))
    expect(b.recreado).toBe(true)
    expect(b.draft_id).not.toBe(a.draft_id)
  })

  it('RECUPERAR una respuesta: destinatarios, asunto, texto propio SIN la cita, modo y adjuntos', async () => {
    const { ctx } = armar()
    const g = await guardarBorrador(ctx, JWT, {
      ...base({ modo: 'responder', thread_id: HILO, ref_message_id: MSG, texto: 'Te respondo esto.' }),
      para: ['cliente@ejemplo.test'],
      cc: ['compras@ejemplo.test'],
      cco: ['archivo@empresa.test'],
      adjuntos: [{ tipo: 'nuevo', nombre: 'cotización.pdf', mime: 'application/pdf', datos: Buffer.from('%PDF').toString('base64') }],
    })
    expect(g.adjuntos).toHaveLength(1)
    const r = await obtenerBorradorEditable(ctx, JWT, CUENTA, g.draft_id)
    expect(r).toMatchObject({
      modo: 'responder',
      thread_id: HILO,
      ref_message_id: MSG,
      para: ['cliente@ejemplo.test'],
      cc: ['compras@ejemplo.test'],
      cco: ['archivo@empresa.test'],
      texto: 'Te respondo esto.',
    })
    expect(r.asunto).toBe('Re: Pedido de cotización')
    expect(r.adjuntos.map((x) => x.nombre)).toEqual(['cotización.pdf'])
  })

  it('RECUPERAR un reenvío: vuelve con el hilo DEL ORIGINAL (no el hilo nuevo del borrador) y se puede enviar', async () => {
    const { ctx, gmail } = armar()
    const g = await guardarBorrador(ctx, JWT, base({ modo: 'reenviar', thread_id: HILO, ref_message_id: MSG, para: ['otro@cliente.test'], texto: 'Te reenvío.' }))
    expect(g.thread_id).not.toBe(HILO) // Gmail le da un hilo propio al borrador del reenvío
    const r = await obtenerBorradorEditable(ctx, JWT, CUENTA, g.draft_id)
    expect(r).toMatchObject({ modo: 'reenviar', modo_origen: 'cabecera', thread_id: HILO, ref_message_id: MSG, texto: 'Te reenvío.' })
    const env = await enviar(ctx, JWT, { ...base({ modo: 'reenviar', thread_id: r.thread_id, ref_message_id: r.ref_message_id, para: r.para, texto: r.texto }), draft_id: g.draft_id, client_request_id: randomUUID() })
    expect(env.estado).toBe('enviado')
    expect(gmail.conteo.enviarBorrador).toBe(1)
  })

  it('SIN X-BT-Compose (Gmail la quitó): el draftId sigue siendo la identidad; una respuesta se reconoce por su In-Reply-To EXACTO', async () => {
    const { ctx, gmail } = armar()
    gmail.hilosCompletos.set(HILO, { id: HILO, messages: [mensajeOriginal()] })
    gmail.conservaCabecerasPropias = false
    const g = await guardarBorrador(ctx, JWT, base({ modo: 'responder', thread_id: HILO, ref_message_id: MSG, texto: 'Respuesta sin cabecera.' }))
    expect(cabecera(gmail.borradores.get(g.draft_id)!.raw, 'X-BT-Compose')).toBeFalsy()
    const r = await obtenerBorradorEditable(ctx, JWT, CUENTA, g.draft_id)
    expect(r).toMatchObject({ draft_id: g.draft_id, modo: 'responder', modo_origen: 'in_reply_to', thread_id: HILO, ref_message_id: MSG, texto: 'Respuesta sin cabecera.' })
    const lista = await listarBorradores(ctx, JWT, CUENTA, HILO)
    expect(lista.borradores[0]).toMatchObject({ draft_id: g.draft_id, modo: 'responder', modo_origen: 'in_reply_to' })
    // Y se actualiza por draftId, sin crear otro.
    await guardarBorrador(ctx, JWT, { ...base({ modo: 'responder', thread_id: HILO, ref_message_id: MSG, texto: 'v2' }), draft_id: g.draft_id })
    expect(gmail.conteo.crearBorrador).toBe(1)
  })

  it('SIN X-BT-Compose y sin In-Reply-To: la pista de la pantalla se usa sólo si valida; si no, se retoma como mail nuevo', async () => {
    const { ctx, gmail } = armar()
    gmail.conservaCabecerasPropias = false
    const g = await guardarBorrador(ctx, JWT, base({ modo: 'reenviar', thread_id: HILO, ref_message_id: MSG, texto: 'Reenvío sin cabecera.' }))
    const sinPista = await obtenerBorradorEditable(ctx, JWT, CUENTA, g.draft_id)
    expect(sinPista).toMatchObject({ modo: 'nuevo', modo_origen: 'sin_datos', ref_message_id: null })
    const conPista = await obtenerBorradorEditable(ctx, JWT, CUENTA, g.draft_id, { modo: 'reenviar', ref_message_id: MSG, thread_id: HILO })
    expect(conPista).toMatchObject({ modo: 'reenviar', modo_origen: 'contexto', thread_id: HILO, ref_message_id: MSG, texto: 'Reenvío sin cabecera.' })
    // Una pista que no valida (mensaje de otro hilo, o un hilo que la persona no ve) NO se usa.
    const mala = await obtenerBorradorEditable(ctx, JWT, CUENTA, g.draft_id, { modo: 'reenviar', ref_message_id: MSG_AJENO, thread_id: HILO })
    expect(mala).toMatchObject({ modo: 'nuevo', modo_origen: 'sin_datos' })
    const ajena = await obtenerBorradorEditable(ctx, JWT, CUENTA, g.draft_id, { modo: 'reenviar', ref_message_id: MSG_AJENO, thread_id: HILO_AJENO })
    expect(ajena).toMatchObject({ modo: 'nuevo', modo_origen: 'sin_datos' })
  })

  it('un adjunto que ya estaba en el borrador sobrevive a los guardados siguientes, con los mismos bytes', async () => {
    const { ctx, gmail } = armar()
    const datos = Buffer.concat([Buffer.from('bytes del adjunto '), Buffer.from([0xff, 0x00, 0x01])])
    const a = await guardarBorrador(ctx, JWT, base({ adjuntos: [{ tipo: 'nuevo', nombre: 'a.bin', mime: 'application/octet-stream', datos: datos.toString('base64') }] }))
    const b = await guardarBorrador(ctx, JWT, base({ draft_id: a.draft_id, texto: 'otro texto', adjuntos: [{ tipo: 'borrador', part_id: a.adjuntos[0]!.part_id }] }))
    const leidos: Buffer[] = []
    leerMime(gmail.borradores.get(b.draft_id)!.raw, (_p, bytes) => {
      leidos.push(bytes)
      return 'x'
    })
    expect(leidos[0]!.equals(datos)).toBe(true)
  })

  it('ENVIAR desde un borrador: se actualiza a la versión final y drafts.send lo consume', async () => {
    const { ctx, gmail } = armar()
    const g = await guardarBorrador(ctx, JWT, base({ modo: 'responder', thread_id: HILO, ref_message_id: MSG, para: ['cliente@ejemplo.test'] }))
    expect(cabecera(gmail.borradores.get(g.draft_id)!.raw, 'X-BT-Compose')).toMatch(/modo=responder/)
    const r = await enviar(ctx, JWT, { ...base({ modo: 'responder', thread_id: HILO, ref_message_id: MSG, para: ['cliente@ejemplo.test'], draft_id: g.draft_id }), client_request_id: randomUUID() })
    expect(r.estado).toBe('enviado')
    expect(gmail.conteo.enviarBorrador).toBe(1)
    expect(gmail.conteo.enviarMensaje).toBe(0)
    expect(gmail.borradores.size).toBe(0)
    expect(cabecera(gmail.enviados[0]!.raw, 'X-BT-Compose')).toBe('')
    expect(gmail.enviados[0]!.threadId).toBe(HILO)
  })

  it('DESCARTAR: drafts.delete + un evento; descartar lo que ya no existe no deja evento', async () => {
    const { ctx, gmail, registro } = armar()
    const g = await guardarBorrador(ctx, JWT, base())
    expect(await descartarBorrador(ctx, JWT, CUENTA, g.draft_id)).toEqual({ descartado: true, existia: true })
    expect(gmail.borradores.size).toBe(0)
    expect(await descartarBorrador(ctx, JWT, CUENTA, g.draft_id)).toEqual({ descartado: true, existia: false })
    expect(registro.eventos.filter((e) => e.accion === 'borrador_descartado')).toHaveLength(1)
  })

  it('autoguardar NO deja eventos', async () => {
    const { ctx, registro } = armar()
    const a = await guardarBorrador(ctx, JWT, base())
    for (let i = 0; i < 5; i++) await guardarBorrador(ctx, JWT, base({ draft_id: a.draft_id, texto: `v${i}` }))
    expect(registro.eventos).toHaveLength(0)
  })

  it('listar los borradores de un hilo sólo trae los de ese hilo', async () => {
    const { ctx } = armar()
    await guardarBorrador(ctx, JWT, base({ modo: 'responder', thread_id: HILO, ref_message_id: MSG }))
    await guardarBorrador(ctx, JWT, base())
    const r = await listarBorradores(ctx, JWT, CUENTA, HILO)
    expect(r.borradores).toHaveLength(1)
    expect(r.borradores[0]).toMatchObject({ thread_id: HILO, modo: 'responder' })
  })
})

describe('firma HMAC', () => {
  it('es la de la RPC: hex de 64, determinística y distinta por usuario', () => {
    const clave = Buffer.alloc(32, 7)
    const a = firmar(clave, 'reservar|c|r|nuevo|u1')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(firmar(clave, 'reservar|c|r|nuevo|u1')).toBe(a)
    expect(firmar(clave, 'reservar|c|r|nuevo|u2')).not.toBe(a)
  })
})
