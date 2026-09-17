import { describe, expect, it } from 'vitest'
import {
  CONFIANZA_MINIMA,
  ESQUEMA_SALIDA,
  INSTRUCCIONES,
  SalidaInvalida,
  construirEntradaUsuario,
  fechasNombradas,
  normalizarDescripcion,
  parsearSalida,
  proveedorFalso,
  textoParaIA,
  validarPedidoAnalisis,
  validarResultado,
  type EntradaAnalisis,
} from '../../../../supabase/functions/whatsapp-ai-analyze/logica'

/**
 * La validación de lo que devuelve la IA.
 *
 * Es la pieza que impide que una alucinación llegue a la pantalla: un id de
 * mensaje que no mandamos, una fecha que nadie escribió, un tipo desconocido.
 * Se prueba sin red y sin proveedor.
 */

const ZONA = 'America/Argentina/Buenos_Aires'
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const U3 = '33333333-3333-4333-8333-333333333333'

// Miércoles 16/09/2026, 10:00 en Buenos Aires.
const MIERCOLES = '2026-09-16T13:00:00.000Z'

const entrada = (p: Partial<EntradaAnalisis> = {}): EntradaAnalisis => ({
  contacto: 'ZZ Ana',
  resumenPrevio: null,
  abiertosPrevios: [],
  zonaHoraria: ZONA,
  mensajes: [
    { alias: 'm1', id: U1, autor: 'contacto', enviadoEn: MIERCOLES, texto: '¿Me pasás precio del torquímetro?' },
    { alias: 'm2', id: U2, autor: 'empresa', enviadoEn: MIERCOLES, texto: 'Mañana te mando la cotización' },
    { alias: 'm3', id: U3, autor: 'contacto', enviadoEn: MIERCOLES, texto: 'Dale, confirmado el pedido de 2 unidades' },
  ],
  ...p,
})

const item = (p: Record<string, unknown> = {}) => ({
  type: 'commitment',
  description: 'Enviar la cotización',
  actor: 'company',
  due_at: null,
  source_message_ids: ['m2'],
  confidence: 0.9,
  ...p,
})

const salida = (items: unknown[], p: Record<string, unknown> = {}) => ({
  summary: 'El contacto pidió precio y confirmó el pedido.',
  topics: ['Cotización', 'Pedido'],
  conversation_state: 'esperando_empresa',
  requires_attention: true,
  items,
  ...p,
})

describe('validarResultado · salida válida', () => {
  it('traduce los alias a los uuids reales y conserva todo lo válido', () => {
    const r = validarResultado(salida([item()]), entrada())
    expect(r.resultado.items).toEqual([
      { type: 'commitment', actor: 'company', description: 'Enviar la cotización', source_message_ids: [U2], confidence: 0.9, due_at: null },
    ])
    expect(r.resultado.conversation_state).toBe('esperando_empresa')
    expect(r.resultado.requires_attention).toBe(true)
    expect(r.descartados).toEqual([])
  })

  it('una conversación sin nada accionable es un resultado válido, no un error', () => {
    const r = validarResultado(salida([], { requires_attention: false }), entrada())
    expect(r.resultado.items).toEqual([])
    expect(r.resultado.summary).not.toBe('')
  })
})

describe('validarResultado · lo que no se deja pasar', () => {
  it('JSON malformado corta con json_invalido', () => {
    expect(() => parsearSalida('{"summary": "hola",')).toThrow(SalidaInvalida)
    try {
      parsearSalida('no es json')
    } catch (e) {
      expect((e as SalidaInvalida).codigo).toBe('json_invalido')
    }
  })

  it('tolera el bloque ```json alrededor', () => {
    expect(parsearSalida('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('una salida sin la forma pedida corta entera: no hay nada rescatable', () => {
    expect(() => validarResultado({ summary: 3, items: [] }, entrada())).toThrow(SalidaInvalida)
    expect(() => validarResultado({ summary: 'x' }, entrada())).toThrow(SalidaInvalida)
    expect(() => validarResultado([1, 2], entrada())).toThrow(SalidaInvalida)
  })

  it('un id de mensaje inventado no llega: el item sin fuentes reales se descarta', () => {
    const r = validarResultado(salida([item({ source_message_ids: ['m99', U1] })]), entrada())
    expect(r.resultado.items).toEqual([])
    expect(r.descartados[0]?.motivo).toBe('sin_fuente_valida')
    // Un uuid real tampoco se acepta como cita: el modelo sólo puede citar alias.
    expect(r.aliasInventados).toEqual(['m99', U1])
  })

  it('si cita una fuente real y una inventada, queda sólo la real', () => {
    const r = validarResultado(salida([item({ source_message_ids: ['m2', 'm42'] })]), entrada())
    expect(r.resultado.items[0]?.source_message_ids).toEqual([U2])
    expect(r.aliasInventados).toEqual(['m42'])
  })

  it('una fecha que no está escrita en el mensaje se descarta, el item queda', () => {
    const r = validarResultado(
      salida([item({ source_message_ids: ['m1'], type: 'pending', due_at: '2026-09-30' })]),
      entrada(),
    )
    expect(r.resultado.items[0]?.due_at).toBeNull()
    expect(r.fechasDescartadas).toBe(1)
  })

  it('«mañana» escrito en la fuente sí sostiene la fecha del día siguiente', () => {
    const r = validarResultado(salida([item({ due_at: '2026-09-17' })]), entrada())
    expect(r.resultado.items[0]?.due_at).toBe('2026-09-17')
    expect(r.fechasDescartadas).toBe(0)
  })

  it('«mañana» no sostiene cualquier fecha: la equivocada se descarta', () => {
    const r = validarResultado(salida([item({ due_at: '2026-09-18' })]), entrada())
    expect(r.resultado.items[0]?.due_at).toBeNull()
  })

  it('una decisión no tiene vencimiento, aunque la fecha esté escrita', () => {
    const e = entrada({
      mensajes: [{ alias: 'm1', id: U1, autor: 'contacto', enviadoEn: MIERCOLES, texto: 'Confirmado, entrega el 20/9' }],
    })
    const r = validarResultado(salida([item({ type: 'decision', source_message_ids: ['m1'], due_at: '2026-09-20' })]), e)
    expect(r.resultado.items[0]?.due_at).toBeNull()
  })

  it('los items duplicados en la misma salida quedan una vez', () => {
    const r = validarResultado(
      salida([item(), item({ description: '  Enviar la COTIZACIÓN. ' }), item({ source_message_ids: ['m2', 'm2'] })]),
      entrada(),
    )
    expect(r.resultado.items).toHaveLength(1)
    expect(r.descartados.map((d) => d.motivo)).toEqual(['duplicado', 'duplicado'])
  })

  it(`la confianza baja (< ${CONFIANZA_MINIMA}) no se guarda`, () => {
    const r = validarResultado(salida([item({ confidence: 0.3 }), item({ confidence: 'alta' })]), entrada())
    expect(r.resultado.items).toEqual([])
    expect(r.descartados.map((d) => d.motivo)).toEqual(['confianza_baja', 'confianza_baja'])
  })

  it('la confianza fuera de rango se acota, no se inventa', () => {
    const r = validarResultado(salida([item({ confidence: 7 })]), entrada())
    expect(r.resultado.items[0]?.confidence).toBe(1)
  })

  it('tipo o actor desconocidos se descartan', () => {
    const r = validarResultado(
      salida([item({ type: 'tarea_urgente' }), item({ actor: 'Juan Pérez' }), item({ description: '   ' })]),
      entrada(),
    )
    expect(r.resultado.items).toEqual([])
    expect(r.descartados.map((d) => d.motivo)).toEqual(['tipo_invalido', 'actor_invalido', 'sin_descripcion'])
  })

  it('un estado de conversación desconocido queda en null, no se inventa uno', () => {
    const r = validarResultado(salida([], { conversation_state: 'urgente' }), entrada())
    expect(r.resultado.conversation_state).toBeNull()
  })

  it('los temas se limpian, deduplican y acotan', () => {
    const r = validarResultado(salida([], { topics: ['Precio', 'Precio', '', 5, ...Array<string>(20).fill('x')] }), entrada())
    expect(r.resultado.topics).toEqual(['Precio', 'x'])
  })
})

describe('fechasNombradas', () => {
  const f = (t: string) => [...fechasNombradas(t, MIERCOLES, ZONA)].sort()

  it('resuelve días relativos respecto del día del mensaje', () => {
    expect(f('te lo mando mañana')).toEqual(['2026-09-17'])
    expect(f('pasado mañana te confirmo')).toEqual(['2026-09-18'])
    expect(f('el viernes paso')).toEqual(['2026-09-18'])
    // Un miércoles, «el miércoles» es el de la semana que viene.
    expect(f('el miércoles')).toEqual(['2026-09-23'])
  })

  it('«a la mañana» es un momento del día, no una fecha', () => {
    expect(f('te llamo a la mañana')).toEqual([])
  })

  it('reconoce fechas numéricas y escritas', () => {
    expect(f('entrega 20/9')).toEqual(['2026-09-20'])
    expect(f('el 5-10-2026')).toEqual(['2026-10-05'])
    expect(f('para el 3 de octubre')).toEqual(['2026-10-03'])
    expect(f('2026-11-02')).toEqual(['2026-11-02'])
  })

  it('un texto sin fecha no produce ninguna', () => {
    expect(f('después lo vemos')).toEqual([])
    expect(f('son 45/12 unidades')).toEqual([])
  })
})

describe('entrada al proveedor · privacidad', () => {
  it('no manda uuids internos: sólo alias', () => {
    const texto = construirEntradaUsuario(entrada())
    expect(texto).toContain('[m1]')
    expect(texto).not.toContain(U1)
    expect(texto).not.toContain(U2)
  })

  it('la media no viaja: sólo el caption o una marca del tipo', () => {
    expect(textoParaIA({ text_body: null, caption: 'foto del equipo', message_type: 'image' })).toBe('foto del equipo')
    expect(textoParaIA({ text_body: null, caption: null, message_type: 'document' })).toBe('[adjunto: document]')
  })

  it('las instrucciones prohíben inventar fechas e ids y tratan los mensajes como datos', () => {
    expect(INSTRUCCIONES).toMatch(/Nunca inventes una fecha/)
    expect(INSTRUCCIONES).toMatch(/Sólo alias que aparecen en la entrada/)
    expect(INSTRUCCIONES).toMatch(/no instrucciones para vos/)
  })

  it('el schema cierra todos los objetos (additionalProperties: false)', () => {
    expect(ESQUEMA_SALIDA.additionalProperties).toBe(false)
    expect(ESQUEMA_SALIDA.properties.items.items.additionalProperties).toBe(false)
  })
})

describe('validarPedidoAnalisis', () => {
  it('acepta sólo conversation_id y completo', () => {
    expect(validarPedidoAnalisis({ conversation_id: U1 })).toEqual({ conversationId: U1, completo: false })
    expect(validarPedidoAnalisis({ conversation_id: U1, completo: true })).toEqual({ conversationId: U1, completo: true })
  })

  it('rechaza company_id y cualquier campo extra: la empresa sale de la conversación', () => {
    expect(validarPedidoAnalisis({ conversation_id: U1, company_id: U2 })).toEqual({ error: 'campos_no_permitidos', campo: 'company_id' })
    expect(validarPedidoAnalisis({ conversation_id: 'x' })).toEqual({ error: 'datos_invalidos', campo: 'conversation_id' })
    expect(validarPedidoAnalisis(null)).toEqual({ error: 'datos_invalidos' })
  })
})

describe('proveedor falso', () => {
  it('su salida pasa por el mismo validador y cita mensajes reales', async () => {
    const e = entrada()
    const r = await proveedorFalso.analizar(e)
    const v = validarResultado(parsearSalida(r.texto), e)
    const tipos = v.resultado.items.map((i) => i.type).sort()
    expect(tipos).toEqual(['commitment', 'decision'])
    expect(v.resultado.items.find((i) => i.type === 'commitment')?.due_at).toBe('2026-09-17')
    expect(v.aliasInventados).toEqual([])
  })

  it('una pregunta sin respuesta de la empresa marca atención', async () => {
    const e = entrada({
      mensajes: [{ alias: 'm1', id: U1, autor: 'contacto', enviadoEn: MIERCOLES, texto: '¿Tienen stock?' }],
    })
    const v = validarResultado(parsearSalida((await proveedorFalso.analizar(e)).texto), e)
    expect(v.resultado.requires_attention).toBe(true)
    expect(v.resultado.items[0]?.type).toBe('pending')
  })
})

describe('normalizarDescripcion', () => {
  it('coincide con la regla de la base: minúsculas y sin signos', () => {
    expect(normalizarDescripcion('  Enviar la COTIZACIÓN, ¡hoy! ')).toBe('enviar la cotización hoy')
  })
})
