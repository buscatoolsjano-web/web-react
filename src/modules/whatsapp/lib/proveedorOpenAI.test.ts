import { describe, expect, it, vi } from 'vitest'
import {
  ESQUEMA_SALIDA_OPENAI,
  FalloProveedor,
  INSTRUCCIONES,
  MAX_OUTPUT_TOKENS_OPENAI,
  PRECIOS_OPENAI,
  SalidaInvalida,
  calcularCostoOpenAI,
  clasificarErrorOpenAI,
  fechasNombradas,
  modeloBase,
  parsearSalida,
  proveedorOpenAI,
  validarResultado,
  type ClienteOpenAI,
  type EntradaAnalisis,
} from '../../../../supabase/functions/whatsapp-ai-analyze/logica'

/**
 * El proveedor OpenAI contra un cliente MOCK de la Responses API. Ningún test
 * sale a la red: el adaptador recibe un objeto con la forma de `openai`.
 */

const ZONA = 'America/Argentina/Buenos_Aires'
const MIERCOLES = '2026-09-16T13:00:00.000Z'
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'

const entrada = (p: Partial<EntradaAnalisis> = {}): EntradaAnalisis => ({
  contacto: 'ZZ Ana',
  resumenPrevio: null,
  abiertosPrevios: [],
  zonaHoraria: ZONA,
  mensajes: [
    { alias: 'm1', id: U1, autor: 'contacto', enviadoEn: MIERCOLES, texto: '¿Me pasás precio?' },
    { alias: 'm2', id: U2, autor: 'empresa', enviadoEn: MIERCOLES, texto: 'Mañana te mando la cotización' },
  ],
  ...p,
})

const salidaValida = {
  summary: 'El contacto pidió precio; Buscatools se comprometió a enviar la cotización mañana.',
  topics: ['Cotización'],
  conversation_state: 'esperando_contacto',
  requires_attention: false,
  items: [
    { type: 'commitment', description: 'Enviar la cotización', actor: 'company', due_at: '2026-09-17', source_message_ids: ['m2'], confidence: 0.9 },
  ],
}

/** Una respuesta de la Responses API como la devuelve el SDK. */
const respuesta = (p: Record<string, unknown> = {}, texto = JSON.stringify(salidaValida)) => ({
  id: 'resp_zz',
  model: 'gpt-5.6-luna-2026-07-09',
  status: 'completed',
  incomplete_details: null,
  output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: texto, annotations: [] }] },
  ],
  usage: {
    input_tokens: 1200,
    input_tokens_details: { cached_tokens: 200, cache_write_tokens: 0 },
    output_tokens: 500,
    output_tokens_details: { reasoning_tokens: 150 },
    total_tokens: 1700,
  },
  ...p,
})

/** Un error como los del SDK: clase con nombre propio y `status`. */
function errorSdk(clase: string, status?: number): Error {
  const Clase = { [clase]: class extends Error {} }[clase]!
  const e = new Clase('mensaje del proveedor que NO se tiene que propagar')
  if (status !== undefined) Object.assign(e, { status })
  return e
}

const mockCliente = (create: (p: Record<string, unknown>) => Promise<unknown>, retrieve = () => Promise.resolve({ id: 'gpt-5.6-luna' })) => {
  const cliente = {
    responses: { create: vi.fn(create) },
    models: { retrieve: vi.fn(retrieve) },
  }
  return cliente satisfies ClienteOpenAI
}

const cfg = { modelo: 'gpt-5.6-luna', esfuerzo: 'low' as const }

async function falla(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof FalloProveedor) return e.codigo
    throw e
  }
  throw new Error('no falló')
}

describe('proveedor OpenAI · el pedido', () => {
  it('usa la Responses API con schema estricto, esfuerzo bajo, tope de salida y sin guardar la respuesta', async () => {
    const c = mockCliente(() => Promise.resolve(respuesta()))
    await proveedorOpenAI(c, cfg).analizar(entrada())
    const p = c.responses.create.mock.calls[0]![0] as Record<string, unknown> & {
      text: { format: { type: string; strict: boolean; schema: unknown } }
      input: { role: string; content: string }[]
    }
    expect(p.model).toBe('gpt-5.6-luna')
    expect(p.instructions).toBe(INSTRUCCIONES)
    expect(p.text.format.type).toBe('json_schema')
    expect(p.text.format.strict).toBe(true)
    expect(p.text.format.schema).toBe(ESQUEMA_SALIDA_OPENAI)
    expect(p.reasoning).toEqual({ effort: 'low' })
    expect(p.max_output_tokens).toBe(MAX_OUTPUT_TOKENS_OPENAI)
    expect(p.store).toBe(false)
    // Sin fallback a otro modelo: no hay ningún parámetro de ese tipo.
    expect(Object.keys(p).sort()).toEqual(['input', 'instructions', 'max_output_tokens', 'model', 'reasoning', 'store', 'text'])
  })

  it('al modelo le llegan alias, nunca uuids internos', async () => {
    const c = mockCliente(() => Promise.resolve(respuesta()))
    await proveedorOpenAI(c, cfg).analizar(entrada())
    const enviado = JSON.stringify(c.responses.create.mock.calls[0]![0])
    expect(enviado).toContain('[m1]')
    expect(enviado).not.toContain(U1)
    expect(enviado).not.toContain(U2)
  })

  it('verifica el modelo UNA vez, antes de mandar la primera conversación', async () => {
    const c = mockCliente(() => Promise.resolve(respuesta()))
    const prov = proveedorOpenAI(c, cfg)
    await prov.analizar(entrada())
    await prov.analizar(entrada())
    expect(c.models.retrieve).toHaveBeenCalledTimes(1)
    expect(c.models.retrieve).toHaveBeenCalledWith('gpt-5.6-luna')
  })

  it('si el modelo no existe para el proyecto, falla SIN mandar ningún mensaje', async () => {
    const c = mockCliente(() => Promise.resolve(respuesta()), () => Promise.reject(errorSdk('NotFoundError', 404)))
    expect(await falla(proveedorOpenAI(c, cfg).analizar(entrada()))).toBe('modelo_no_disponible')
    expect(c.responses.create).not.toHaveBeenCalled()
  })
})

describe('proveedor OpenAI · respuestas', () => {
  it('salida estructurada válida: devuelve el texto, el modelo que respondió y el uso desglosado', async () => {
    const c = mockCliente(() => Promise.resolve(respuesta()))
    const r = await proveedorOpenAI(c, cfg).analizar(entrada())
    expect(r.modelo).toBe('gpt-5.6-luna-2026-07-09')
    expect(r.uso).toEqual({ inputTokens: 1200, outputTokens: 500, cachedTokens: 200, reasoningTokens: 150 })
    const v = validarResultado(parsearSalida(r.texto), entrada())
    expect(v.resultado.items[0]).toMatchObject({ type: 'commitment', source_message_ids: [U2], due_at: '2026-09-17' })
  })

  it('una negativa del modelo es un fallo «refusal», no una salida', async () => {
    const c = mockCliente(() => Promise.resolve(respuesta({
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'No puedo.' }] }],
    })))
    expect(await falla(proveedorOpenAI(c, cfg).analizar(entrada()))).toBe('refusal')
  })

  it('una respuesta cortada por el tope de salida es «truncado»', async () => {
    const c = mockCliente(() => Promise.resolve(respuesta({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })))
    expect(await falla(proveedorOpenAI(c, cfg).analizar(entrada()))).toBe('truncado')
  })

  it('un filtro de contenido es «refusal»', async () => {
    const c = mockCliente(() => Promise.resolve(respuesta({ status: 'incomplete', incomplete_details: { reason: 'content_filter' } })))
    expect(await falla(proveedorOpenAI(c, cfg).analizar(entrada()))).toBe('refusal')
  })

  it('JSON malformado no rompe el adaptador: lo corta la validación', async () => {
    const c = mockCliente(() => Promise.resolve(respuesta({}, '{"summary": "a",')))
    const r = await proveedorOpenAI(c, cfg).analizar(entrada())
    expect(() => parsearSalida(r.texto)).toThrow(SalidaInvalida)
  })

  it('una salida que viola el schema la corta la validación de negocio', async () => {
    const c = mockCliente(() => Promise.resolve(respuesta({}, JSON.stringify({ summary: 3, items: 'x' }))))
    const r = await proveedorOpenAI(c, cfg).analizar(entrada())
    expect(() => validarResultado(parsearSalida(r.texto), entrada())).toThrow(SalidaInvalida)
  })

  it('fuentes inventadas, fechas no escritas, duplicados y confianza baja se descartan igual', async () => {
    const salida = {
      ...salidaValida,
      items: [
        { type: 'decision', description: 'Precio aceptado', actor: 'contact', due_at: null, source_message_ids: ['m9'], confidence: 0.95 },
        { type: 'pending', description: 'Responder el precio', actor: 'company', due_at: '2026-10-01', source_message_ids: ['m1'], confidence: 0.9 },
        { type: 'pending', description: 'Responder el precio', actor: 'company', due_at: null, source_message_ids: ['m1'], confidence: 0.9 },
        { type: 'next_step', description: 'Llamar', actor: 'company', due_at: null, source_message_ids: ['m2'], confidence: 0.2 },
      ],
    }
    const c = mockCliente(() => Promise.resolve(respuesta({}, JSON.stringify(salida))))
    const r = await proveedorOpenAI(c, cfg).analizar(entrada())
    const v = validarResultado(parsearSalida(r.texto), entrada())
    expect(v.resultado.items).toHaveLength(1)
    expect(v.resultado.items[0]).toMatchObject({ type: 'pending', due_at: null })
    expect(v.aliasInventados).toEqual(['m9'])
    expect(v.descartados.map((d) => d.motivo).sort()).toEqual(['confianza_baja', 'duplicado', 'sin_fuente_valida'])
  })

  it('sin mensajes válidos igual produce un resultado validable', async () => {
    const c = mockCliente(() => Promise.resolve(respuesta({}, JSON.stringify({ ...salidaValida, items: [] }))))
    const e = entrada({ mensajes: [] })
    const r = await proveedorOpenAI(c, cfg).analizar(e)
    expect(validarResultado(parsearSalida(r.texto), e).resultado.items).toEqual([])
  })
})

describe('proveedor OpenAI · errores', () => {
  it.each([
    ['APIConnectionTimeoutError', undefined, 'timeout'],
    ['APIConnectionError', undefined, 'red'],
    ['AuthenticationError', 401, 'auth'],
    ['PermissionDeniedError', 403, 'auth'],
    ['RateLimitError', 429, 'limite'],
    ['InternalServerError', 500, 'caido'],
    ['InternalServerError', 503, 'caido'],
    ['BadRequestError', 400, 'rechazo'],
  ])('%s (%s) → %s', async (clase, status, codigo) => {
    const c = mockCliente(() => Promise.reject(errorSdk(clase, status)))
    expect(await falla(proveedorOpenAI(c, cfg).analizar(entrada()))).toBe(codigo)
  })

  it('el mensaje del proveedor nunca se propaga', async () => {
    const c = mockCliente(() => Promise.reject(errorSdk('AuthenticationError', 401)))
    try {
      await proveedorOpenAI(c, cfg).analizar(entrada())
    } catch (e) {
      expect((e as Error).message).not.toContain('proveedor que NO')
    }
  })

  it('un error sin forma conocida es «caido», no una excepción cruda', () => {
    expect(clasificarErrorOpenAI(undefined)).toBe('caido')
    expect(clasificarErrorOpenAI('texto')).toBe('caido')
  })
})

describe('costo', () => {
  it('usa los precios verificados de Luna y desglosa entrada, caché y salida', () => {
    const c = calcularCostoOpenAI('gpt-5.6-luna-2026-07-09', { inputTokens: 1200, outputTokens: 500, cachedTokens: 200, reasoningTokens: 150 })
    // 1000 × 0,20 + 200 × 0,02 + 500 × 1,20 (el razonamiento ya está dentro de la salida)
    expect(c).toEqual({ modelo: 'gpt-5.6-luna', entradaUsd: 0.0002, entradaCacheadaUsd: 0.000004, salidaUsd: 0.0006, totalUsd: 0.000804 })
  })

  it('Terra cuesta diez veces más con el mismo uso', () => {
    const luna = calcularCostoOpenAI('gpt-5.6-luna', { inputTokens: 1000, outputTokens: 1000 })!
    const terra = calcularCostoOpenAI('gpt-5.6-terra', { inputTokens: 1000, outputTokens: 1000 })!
    expect(terra.totalUsd).toBeCloseTo(luna.totalUsd * 10, 10)
  })

  it('un modelo sin precio verificado no tiene costo inventado', () => {
    expect(calcularCostoOpenAI('gpt-otro', { inputTokens: 1, outputTokens: 1 })).toBeNull()
    expect(modeloBase('gpt-5.6-lunatico')).toBeNull()
    expect(Object.keys(PRECIOS_OPENAI)).toEqual(['gpt-5.6-luna', 'gpt-5.6-terra'])
  })

  it('sin uso informado no hay costo', () => {
    expect(calcularCostoOpenAI('gpt-5.6-luna', { inputTokens: null, outputTokens: null })).toBeNull()
  })
})

describe('schema estricto de OpenAI', () => {
  it('cierra todos los objetos y exige todos los campos', () => {
    expect(ESQUEMA_SALIDA_OPENAI.additionalProperties).toBe(false)
    expect(ESQUEMA_SALIDA_OPENAI.required).toEqual(Object.keys(ESQUEMA_SALIDA_OPENAI.properties))
    const item = ESQUEMA_SALIDA_OPENAI.properties.items.items
    expect(item.additionalProperties).toBe(false)
    expect(item.required).toEqual(Object.keys(item.properties))
    expect(item.properties.confidence).toMatchObject({ minimum: 0, maximum: 1 })
    expect(item.properties.due_at.type).toEqual(['string', 'null'])
  })
})

describe('fechas relativas', () => {
  const f = (t: string) => [...fechasNombradas(t, MIERCOLES, ZONA)]
  it('«la semana que viene», «cuando pueda» y «más adelante» no son una fecha', () => {
    expect(f('te lo confirmo la semana que viene')).toEqual([])
    expect(f('te lo mando cuando pueda')).toEqual([])
    expect(f('lo vemos más adelante')).toEqual([])
  })

  it('«el viernes» sí, resuelto respecto del mensaje y sin hora', () => {
    expect(f('el viernes te confirmo')).toEqual(['2026-09-18'])
  })

  it('las instrucciones lo dicen explícitamente', () => {
    expect(INSTRUCCIONES).toMatch(/la semana que viene/)
    expect(INSTRUCCIONES).toMatch(/cuando pueda/)
    expect(INSTRUCCIONES).toMatch(/intención .* NO es un compromiso/)
    expect(INSTRUCCIONES).toMatch(/español/)
  })
})
