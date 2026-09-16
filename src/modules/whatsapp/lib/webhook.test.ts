import { describe, expect, it } from 'vitest'
import {
  aIso,
  bytesIguales,
  extraerMedia,
  idDeEvento,
  normalizarPayload,
  resolverHandshake,
  verificarFirma,
  type EventoMensaje,
} from '../../../../supabase/functions/whatsapp-webhook/logica'

/**
 * La lógica del webhook, probada desde la suite de siempre.
 *
 * Vive en `supabase/functions/` porque la ejecuta Deno, pero es código puro y
 * es lo más delicado de toda la integración: si la firma se valida mal,
 * cualquiera que conozca la URL puede escribir en la bandeja.
 */

const SECRETO = 'secreto-de-prueba-no-es-el-real'

/** Firma un cuerpo igual que lo hace Meta, para los casos positivos. */
async function firmar(cuerpo: string, secreto = SECRETO): Promise<string> {
  const enc = new TextEncoder()
  const clave = await crypto.subtle.importKey(
    'raw', enc.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', clave, enc.encode(cuerpo)))
  return `sha256=${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

const params = (o: Record<string, string>) => new URLSearchParams(o)

describe('handshake de verificación', () => {
  it('con el token correcto devuelve el challenge crudo, sin JSON ni comillas', () => {
    const r = resolverHandshake(
      params({ 'hub.mode': 'subscribe', 'hub.verify_token': 'T0K3N', 'hub.challenge': '1158201444' }),
      'T0K3N',
    )
    expect(r.status).toBe(200)
    expect(r.body).toBe('1158201444')
    // Si esto fuera JSON, Meta rechaza la configuración del webhook.
    expect(r.body.startsWith('"')).toBe(false)
  })

  it('con el token equivocado responde 403 y no filtra el challenge', () => {
    const r = resolverHandshake(
      params({ 'hub.mode': 'subscribe', 'hub.verify_token': 'otro', 'hub.challenge': '1158201444' }),
      'T0K3N',
    )
    expect(r.status).toBe(403)
    expect(r.body).not.toContain('1158201444')
  })

  it('sin secreto configurado no verifica nada, aunque el token venga vacío', () => {
    const r = resolverHandshake(
      params({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': 'x' }),
      undefined,
    )
    expect(r.status).toBe(403)
  })

  it('un modo que no es subscribe se rechaza', () => {
    const r = resolverHandshake(
      params({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'T0K3N', 'hub.challenge': 'x' }),
      'T0K3N',
    )
    expect(r.status).toBe(403)
  })
})

describe('firma X-Hub-Signature-256', () => {
  const cuerpo = '{"object":"whatsapp_business_account","entry":[]}'

  it('una firma válida sobre el cuerpo crudo pasa', async () => {
    expect(await verificarFirma(cuerpo, await firmar(cuerpo), SECRETO)).toBe('ok')
  })

  it('sin header se rechaza', async () => {
    expect(await verificarFirma(cuerpo, null, SECRETO)).toBe('sin_header')
  })

  it('sin App Secret configurado se rechaza TODO, aun con una firma bien formada', async () => {
    expect(await verificarFirma(cuerpo, await firmar(cuerpo), undefined)).toBe('sin_secreto')
  })

  it.each([
    ['sin prefijo', 'abcdef'],
    ['otro algoritmo', 'sha1=abcdef'],
    ['no es hexadecimal', `sha256=${'z'.repeat(64)}`],
    ['largo equivocado', 'sha256=deadbeef'],
  ])('formato inválido: %s', async (_caso, header) => {
    expect(await verificarFirma(cuerpo, header, SECRETO)).toBe('formato_invalido')
  })

  it('una firma de otro secreto no coincide', async () => {
    expect(await verificarFirma(cuerpo, await firmar(cuerpo, 'otro'), SECRETO)).toBe('no_coincide')
  })

  it('un solo byte distinto en el cuerpo invalida la firma', async () => {
    const firma = await firmar(cuerpo)
    expect(await verificarFirma(cuerpo.replace('[]', '[ ]'), firma, SECRETO)).toBe('no_coincide')
  })

  it('el HMAC es del cuerpo CRUDO: reserializar el JSON lo rompe', async () => {
    // Este es el bug clásico. El mismo objeto, con las claves en otro orden,
    // produce otro HMAC; validar sobre `JSON.stringify(JSON.parse(x))` falla
    // siempre, y de ahí a "desactivemos la validación" hay un paso.
    // Con espacios, como lo manda Meta de verdad: al reserializar desaparecen.
    const original = '{"object": "whatsapp_business_account", "entry": [{"id": "1"}]}'
    const reserializado = JSON.stringify(JSON.parse(original))
    const firma = await firmar(original)
    expect(await verificarFirma(original, firma, SECRETO)).toBe('ok')
    expect(reserializado).not.toBe(original)
    expect(await verificarFirma(reserializado, firma, SECRETO)).toBe('no_coincide')
  })

  it('la comparación no corta en el primer byte distinto', () => {
    const a = new Uint8Array([1, 2, 3, 4])
    expect(bytesIguales(a, new Uint8Array([9, 2, 3, 4]))).toBe(false)
    expect(bytesIguales(a, new Uint8Array([1, 2, 3, 9]))).toBe(false)
    expect(bytesIguales(a, new Uint8Array([1, 2, 3, 4]))).toBe(true)
    expect(bytesIguales(a, new Uint8Array([1, 2, 3]))).toBe(false)
  })
})

// ── Payload ────────────────────────────────────────────────────────────────

const mensaje = (over: Record<string, unknown> = {}) => ({
  from: '5491133334444',
  id: 'wamid.AAA',
  timestamp: '1789574400',
  type: 'text',
  text: { body: 'Hola, ¿tienen candados LOTO?' },
  ...over,
})

const payload = (value: Record<string, unknown>, wabaId = '1499762661645319') => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: wabaId,
      changes: [
        {
          field: 'messages',
          value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '1267748423093872' }, ...value },
        },
      ],
    },
  ],
})

describe('normalización del payload', () => {
  it('un mensaje de texto sale completo, con su WABA y su phone_number_id', () => {
    const [e] = normalizarPayload(
      payload({
        contacts: [{ wa_id: '5491133334444', profile: { name: 'Ana' } }],
        messages: [mensaje()],
      }),
    ) as EventoMensaje[]

    expect(e).toMatchObject({
      clase: 'mensaje',
      phoneNumberId: '1267748423093872',
      wabaId: '1499762661645319',
      waId: '5491133334444',
      profileName: 'Ana',
      providerMessageId: 'wamid.AAA',
      tipo: 'text',
      texto: 'Hola, ¿tienen candados LOTO?',
    })
    expect(e!.timestamp).toBe(new Date(1789574400 * 1000).toISOString())
  })

  it('el WABA sale del evento; no se da por sentado cuál es', () => {
    const [e] = normalizarPayload(payload({ messages: [mensaje()] }, '27996680623359463'))
    expect(e!.wabaId).toBe('27996680623359463')
  })

  it('itera varios entry, varios change y varios mensajes: no se pierde ninguno', () => {
    const p = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'W1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'P1' },
                messages: [mensaje({ id: 'wamid.1' }), mensaje({ id: 'wamid.2' })],
              },
            },
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'P1' },
                statuses: [{ id: 'wamid.9', status: 'delivered', timestamp: '1789574400' }],
              },
            },
          ],
        },
        {
          id: 'W2',
          changes: [
            {
              field: 'messages',
              value: { metadata: { phone_number_id: 'P2' }, messages: [mensaje({ id: 'wamid.3' })] },
            },
          ],
        },
      ],
    }
    const eventos = normalizarPayload(p)
    expect(eventos).toHaveLength(4)
    expect(eventos.filter((e) => e.clase === 'mensaje')).toHaveLength(3)
    expect(eventos.map((e) => e.phoneNumberId)).toEqual(['P1', 'P1', 'P1', 'P2'])
  })

  it('guarda el tipo aunque no sepa dibujarlo, y no lo confunde con texto', () => {
    const [e] = normalizarPayload(
      payload({ messages: [mensaje({ type: 'order', order: { catalog_id: 'c1' }, text: undefined })] }),
    ) as EventoMensaje[]
    expect(e!.tipo).toBe('order')
    expect(e!.texto).toBeNull()
  })

  it('un tipo que Meta agregue después entra como unknown, conservando el crudo', () => {
    const [e] = normalizarPayload(
      payload({ messages: [mensaje({ type: 'holograma', text: undefined })] }),
    ) as EventoMensaje[]
    expect(e!.tipo).toBe('unknown')
    expect(e!.tipoCrudo).toBe('holograma')
  })

  it('una imagen trae su media y su caption', () => {
    const [e] = normalizarPayload(
      payload({
        messages: [
          mensaje({
            type: 'image',
            text: undefined,
            image: { id: 'MID1', mime_type: 'image/jpeg', sha256: 'abc', caption: 'La chapa' },
          }),
        ],
      }),
    ) as EventoMensaje[]
    expect(e!.media).toEqual({ id: 'MID1', mime_type: 'image/jpeg', sha256: 'abc' })
    expect(e!.caption).toBe('La chapa')
  })

  it('un texto no tiene media', () => {
    expect(extraerMedia('text', { text: { body: 'x' } })).toBeNull()
  })

  it('una respuesta a otro mensaje conserva a cuál', () => {
    const [e] = normalizarPayload(
      payload({ messages: [mensaje({ context: { id: 'wamid.PREVIO' } })] }),
    ) as EventoMensaje[]
    expect(e!.replyTo).toBe('wamid.PREVIO')
  })

  it('un acuse fallido trae el código y un detalle acotado', () => {
    const [e] = normalizarPayload(
      payload({
        statuses: [
          {
            id: 'wamid.X',
            status: 'failed',
            timestamp: '1789574400',
            errors: [{ code: 131047, title: 'Re-engagement message', error_data: { details: 'Fuera de la ventana' } }],
          },
        ],
      }),
    )
    expect(e).toMatchObject({ clase: 'estado', estado: 'failed', errorCode: 131047, errorDetalle: 'Fuera de la ventana' })
  })

  it('ignora lo que no es del objeto de WhatsApp', () => {
    expect(normalizarPayload({ object: 'page', entry: [{ id: '1' }] })).toEqual([])
    expect(normalizarPayload(null)).toEqual([])
    expect(normalizarPayload('{}')).toEqual([])
  })

  it('un change de otro campo (por ejemplo, calidad del número) no se procesa', () => {
    const p = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'W1', changes: [{ field: 'phone_number_quality_update', value: { metadata: { phone_number_id: 'P1' } } }] }],
    }
    expect(normalizarPayload(p)).toEqual([])
  })

  it('un mensaje sin id o sin remitente se descarta en vez de entrar a medias', () => {
    const sinId = normalizarPayload(payload({ messages: [mensaje({ id: undefined })] }))
    const sinFrom = normalizarPayload(payload({ messages: [mensaje({ from: undefined })] }))
    expect(sinId).toEqual([])
    expect(sinFrom).toEqual([])
  })

  it('una fecha inválida queda en null: no se reemplaza por hoy', () => {
    expect(aIso('0')).toBeNull()
    expect(aIso('no-es-un-numero')).toBeNull()
    expect(aIso(undefined)).toBeNull()
  })

  it('el id de evento distingue mensaje de acuse y acuse de acuse', () => {
    const [m] = normalizarPayload(payload({ messages: [mensaje()] }))
    const acuses = normalizarPayload(
      payload({
        statuses: [
          { id: 'wamid.AAA', status: 'sent', timestamp: '1' },
          { id: 'wamid.AAA', status: 'read', timestamp: '2' },
        ],
      }),
    )
    expect(idDeEvento(m!)).not.toBe(idDeEvento(acuses[0]!))
    expect(idDeEvento(acuses[0]!)).not.toBe(idDeEvento(acuses[1]!))
  })
})
