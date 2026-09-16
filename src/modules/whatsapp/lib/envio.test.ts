import { describe, expect, it } from 'vitest'
import {
  CODIGOS_BASE,
  codigoDeErrorBase,
  cuerpoDeTexto,
  interpretarErrorMeta,
  mensajeParaLaPersona,
  validarPedido,
} from '../../../../supabase/functions/whatsapp-send-message/logica'

const CONV = '11111111-1111-4111-8111-111111111111'
const REQ = '22222222-2222-4222-8222-222222222222'
const valido = { conversation_id: CONV, texto: 'Hola', client_request_id: REQ }

describe('validación del pedido de envío', () => {
  it('acepta lo mínimo y nada más', () => {
    expect(validarPedido(valido)).toEqual({ conversationId: CONV, texto: 'Hola', clientRequestId: REQ })
  })

  it.each(['phone_number_id', 'waba_id', 'to', 'access_token', 'account_id'])(
    'rechaza %s: el destinatario y la cuenta NO los elige el navegador',
    (campo) => {
      expect(validarPedido({ ...valido, [campo]: 'lo-que-sea' })).toEqual({
        error: 'campos_no_permitidos',
        campo,
      })
    },
  )

  it('exige un client_request_id: es lo que evita el mensaje duplicado', () => {
    const sinId = { conversation_id: CONV, texto: 'Hola' }
    expect(validarPedido(sinId)).toEqual({ error: 'datos_invalidos', campo: 'client_request_id' })
    expect(validarPedido({ ...valido, client_request_id: 'no-es-uuid' })).toEqual({
      error: 'datos_invalidos',
      campo: 'client_request_id',
    })
  })

  it('un conversation_id que no es uuid no llega a la base', () => {
    expect(validarPedido({ ...valido, conversation_id: "1' or '1'='1" })).toEqual({
      error: 'datos_invalidos',
      campo: 'conversation_id',
    })
  })

  it('un texto vacío o sólo espacios no se manda', () => {
    expect(validarPedido({ ...valido, texto: '   ' })).toEqual({ error: 'texto_vacio' })
  })

  it('corta en el límite de Meta', () => {
    expect(validarPedido({ ...valido, texto: 'x'.repeat(4096) })).not.toHaveProperty('error')
    expect(validarPedido({ ...valido, texto: 'x'.repeat(4097) })).toEqual({ error: 'texto_largo' })
  })

  it('un cuerpo que no es un objeto se rechaza', () => {
    for (const malo of [null, 'texto', 42, ['a']]) {
      expect(validarPedido(malo)).toEqual({ error: 'datos_invalidos' })
    }
  })
})

describe('errores de la base', () => {
  it('reconoce cada código y le da su status', () => {
    for (const [codigo, status] of Object.entries(CODIGOS_BASE)) {
      expect(codigoDeErrorBase(`ERROR: ${codigo} (SQLSTATE 42501)`)).toBe(codigo)
      expect(status).toBeGreaterThanOrEqual(400)
    }
  })

  it('la ventana cerrada tiene su propio código, no un 500 genérico', () => {
    expect(codigoDeErrorBase('TEMPLATE_REQUIRED')).toBe('TEMPLATE_REQUIRED')
    expect(CODIGOS_BASE.TEMPLATE_REQUIRED).toBe(409)
  })

  it('un error que no conocemos no se disfraza de código conocido', () => {
    expect(codigoDeErrorBase('deadlock detected')).toBeNull()
    expect(codigoDeErrorBase(undefined)).toBeNull()
  })
})

describe('errores de Meta', () => {
  it('extrae código, subcódigo y detalle', () => {
    const e = interpretarErrorMeta(400, {
      error: {
        message: 'Unsupported post request',
        code: 131047,
        error_subcode: 2494010,
        error_data: { details: 'Message failed to send because more than 24 hours have passed' },
      },
    })
    expect(e).toMatchObject({ status: 400, code: 131047, subcode: 2494010, reintentable: false })
    expect(e.detalle).toContain('24 hours')
  })

  it('429 y 5xx son reintentables; 400 y 401 no', () => {
    expect(interpretarErrorMeta(429, {}).reintentable).toBe(true)
    expect(interpretarErrorMeta(503, {}).reintentable).toBe(true)
    expect(interpretarErrorMeta(400, {}).reintentable).toBe(false)
    expect(interpretarErrorMeta(401, {}).reintentable).toBe(false)
  })

  it('el detalle se recorta: no se guarda un volcado entero', () => {
    const e = interpretarErrorMeta(400, { error: { message: 'x'.repeat(5000) } })
    expect(e.detalle.length).toBeLessThanOrEqual(500)
  })

  it('un cuerpo vacío o raro no rompe', () => {
    expect(interpretarErrorMeta(500, null).detalle).toContain('500')
    expect(interpretarErrorMeta(500, 'oops').code).toBeNull()
  })

  it('el mensaje para la persona no menciona tokens ni jerga de Graph', () => {
    const casos = [
      interpretarErrorMeta(401, { error: { code: 190 } }),
      interpretarErrorMeta(429, {}),
      interpretarErrorMeta(500, {}),
      interpretarErrorMeta(400, { error: { code: 131047 } }),
      interpretarErrorMeta(400, { error: { code: 131026 } }),
    ]
    for (const c of casos) {
      const texto = mensajeParaLaPersona(c)
      expect(texto.length).toBeGreaterThan(10)
      expect(texto.toLowerCase()).not.toContain('token')
      expect(texto.toLowerCase()).not.toContain('bearer')
      expect(texto).not.toContain('graph.facebook')
    }
  })
})

describe('cuerpo para Graph', () => {
  it('es el que documenta Meta para un texto', () => {
    expect(cuerpoDeTexto('5491133334444', 'Hola')).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5491133334444',
      type: 'text',
      text: { preview_url: false, body: 'Hola' },
    })
  })
})
