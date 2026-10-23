/**
 * El candado de Cata (Fase 85).
 *
 * Lo que se prueba acá no es el formato de una respuesta: es que por esta
 * puerta no pase una herramienta que vea clientes. Es la única prueba de este
 * archivo que importa de verdad, y por eso hay varias que la miran de distintos
 * ángulos.
 */
import { describe, expect, it, vi } from 'vitest'
import { HERRAMIENTAS } from '../asistente/herramientas'
import {
  AGENTE_DE_CATA,
  candadoDeCata,
  contextoDeLlamada,
  DE_MAS,
  esDeCata,
  herramientasDelAgente,
  HERRAMIENTAS_DE_CATA,
  PROMPT_HABLADO,
} from './logica'

describe('la lista blanca (Fase 146)', () => {
  it('es el catálogo + la lectura del sistema + la cotización', () => {
    expect([...HERRAMIENTAS_DE_CATA].sort()).toEqual([
      'buscar_cliente',
      'buscar_documentos',
      'buscar_productos',
      'crear_cotizacion',
      'ficha_producto',
      'historial_del_cliente',
      'precios_del_cliente',
      'preparar_cotizacion',
      'ranking_comercial',
      'resumen_catalogo',
      'stock_actual',
      'ultimo_costo',
      'ver_documento',
    ])
  })

  it('todas existen de verdad en el catálogo de herramientas', () => {
    // Un nombre mal escrito en la lista blanca no rompe nada visible: la
    // herramienta sencillamente nunca se ejecuta y Cata contesta que no sabe.
    const nombres = HERRAMIENTAS.map((h) => h.id)
    for (const n of HERRAMIENTAS_DE_CATA) expect(nombres).toContain(n)
  })

  it('sigue dejando AFUERA correos y WhatsApp, y cualquiera nueva por olvido', () => {
    // Recorre TODAS las herramientas de la casa: las que no están en la lista
    // blanca quedan afuera. Así una herramienta nueva no entra sola, y los
    // correos y el WhatsApp —que no son de Cata— se quedan afuera explícito.
    const permitidas = new Set(HERRAMIENTAS_DE_CATA)
    for (const h of HERRAMIENTAS) {
      if (permitidas.has(h.id)) continue
      expect(esDeCata(h.id)).toBe(false)
    }
    expect(esDeCata('buscar_emails')).toBe(false)
  })

  it('tiene TODAS las del agente que contesta', () => {
    // Al revés sería peor que un error: el agente ofrecería al modelo una
    // herramienta que después rebota, y Cata contestaría «no puedo» sobre algo
    // que sí tiene.
    for (const h of herramientasDelAgente()) expect(HERRAMIENTAS_DE_CATA).toContain(h)
  })

  it('y lo que tiene DE MÁS está puesto a mano, una por una', () => {
    // Si alguien le agrega al agente `catalogo` una herramienta, Cata no se la
    // gana sola: este test falla y alguien decide. DE_MAS es la lista auditable
    // de todo lo que Cata tiene más allá del catálogo puro.
    const delAgente = new Set(herramientasDelAgente())
    const extra = HERRAMIENTAS_DE_CATA.filter((h) => !delAgente.has(h))
    expect([...extra].sort()).toEqual([...DE_MAS].sort())
  })

  it('la única escritura de DE_MAS es la cotización', () => {
    // Todo lo demás que Cata gana es de LECTURA. La escritura empieza y termina
    // en la cotización, y por eso el prompt le pone la confirmación hablada.
    expect(DE_MAS).toContain('crear_cotizacion')
    expect(DE_MAS).toContain('preparar_cotizacion')
    expect(DE_MAS).not.toContain('crear_compra')
  })

  it('el agente que contesta existe', () => {
    expect(herramientasDelAgente().length).toBeGreaterThan(0)
    expect(AGENTE_DE_CATA).toBe('catalogo')
  })
})

describe('candadoDeCata', () => {
  it('deja pasar las de la lista, con sus argumentos intactos', async () => {
    const adentro = vi.fn(async () => 'listo')
    const ejecutar = candadoDeCata(adentro)

    await expect(ejecutar('buscar_productos', { texto: 'punta ph1' })).resolves.toBe('listo')
    expect(adentro).toHaveBeenCalledWith('buscar_productos', { texto: 'punta ph1' })
  })

  it('deja pasar lo nuevo: un cliente y una cotización', async () => {
    const adentro = vi.fn(async () => 'ok')
    const ejecutar = candadoDeCata(adentro)
    await expect(ejecutar('buscar_cliente', { texto: 'Mirgor' })).resolves.toBe('ok')
    await expect(ejecutar('crear_cotizacion', {})).resolves.toBe('ok')
  })

  it('rebota lo que NO está (un correo) y ni siquiera llama al ejecutor', async () => {
    const adentro = vi.fn(async () => 'no tendría que verse esto')
    const ejecutar = candadoDeCata(adentro)

    const r = await ejecutar('buscar_emails', { texto: 'Mirgor' })

    expect(adentro).not.toHaveBeenCalled()
    expect(JSON.parse(r)).toMatchObject({ problema: expect.stringContaining('buscar_emails') })
  })

  it('rebota también una herramienta inventada', async () => {
    const adentro = vi.fn(async () => 'nada')
    const r = await candadoDeCata(adentro)('leer_todo', {})

    expect(adentro).not.toHaveBeenCalled()
    expect(r).toContain('problema')
  })

  it('el rebote vuelve como texto y no como excepción', async () => {
    // Lanzar le cortaría la llamada a quien está del otro lado del teléfono.
    const r = candadoDeCata(async () => 'nada')('mandar_whatsapp', {})
    await expect(r).resolves.toEqual(expect.any(String))
  })

  it('no se traga el fallo del ejecutor de adentro', async () => {
    const adentro = async () => JSON.stringify({ problema: 'no encontré ese SKU' })
    const r = await candadoDeCata(adentro)('ficha_producto', { sku: 'XX' })
    expect(JSON.parse(r)).toEqual({ problema: 'no encontré ese SKU' })
  })
})

describe('el prompt hablado', () => {
  it('prohíbe los asteriscos, que es lo que PROMPT_COMUN permite', () => {
    expect(PROMPT_HABLADO).toContain('asterisco')
  })

  it('dice de qué no sabe (correos, WhatsApp, compras)', () => {
    for (const tema of ['correo', 'WhatsApp', 'compras']) {
      expect(PROMPT_HABLADO).toContain(tema)
    }
  })

  it('obliga a confirmar en voz antes de crear una cotización', () => {
    // Es el resguardo de la única escritura: la voz se entiende mal y un
    // documento no se deshace solo.
    expect(PROMPT_HABLADO).toContain('CONFIRMÁ ANTES DE CREAR')
    expect(PROMPT_HABLADO).toMatch(/SÓLO si te dicen que sí/i)
  })

  it('explica qué quiere decir cada atributo del catálogo', () => {
    // «Necesito que sea experta en todo el catálogo y sepa leerlo; que sepa
    // interpretar qué es cada característica, cada atributo.» Los nombres
    // salen de la base: son las claves que de verdad tienen los productos.
    for (const atributo of [
      'encastre',
      'medida',
      'largo',
      'torq_min',
      'min_kg',
      'rpm',
      'voltaje',
      'sufijos',
    ]) {
      expect(PROMPT_HABLADO).toContain(atributo)
    }
  })

  it('distingue el precio del costo, y dice que el costo es interno', () => {
    expect(PROMPT_HABLADO).toContain('COSTO')
    expect(PROMPT_HABLADO).toMatch(/interna/)
  })

  it('le prohíbe decir «no te escuché» cuando lo que pasó es que no encontró', () => {
    // Es la queja textual: «le pregunto algo y me dice, no te escuché,
    // ¿puedes repetir? Y no me gusta eso».
    expect(PROMPT_HABLADO).toContain('no te escuché')
    expect(PROMPT_HABLADO).toMatch(/dos cosas distintas/)
  })

  it('le dice que busque antes de dar algo por inexistente', () => {
    expect(PROMPT_HABLADO).toMatch(/BUSCAR ANTES DE AFIRMAR/)
    expect(PROMPT_HABLADO).toMatch(/antes de decir «no hay»/i)
  })

  it('pone un presupuesto de palabras, que es lo único que un modelo respeta', () => {
    // «Una o dos frases» no alcanzó: contestaba cuatro renglones con cuatro
    // SKU. Un número se puede obedecer; «corto» se interpreta.
    expect(PROMPT_HABLADO).toMatch(/VEINTICINCO PALABRAS/)
    expect(PROMPT_HABLADO).toMatch(/UNA frase/)
    expect(PROMPT_HABLADO).toMatch(/UN producto/)
  })

  it('trae el ejemplo de lo que salió mal, junto al de lo que corresponde', () => {
    // Un contraste enseña más que una regla: la respuesta larga es REAL, de
    // una llamada, y todo lo que dice es cierto. El problema es el tamaño.
    expect(PROMPT_HABLADO).toContain('ASÍ NO')
    expect(PROMPT_HABLADO).toContain('ASÍ SÍ')
    const bien = PROMPT_HABLADO.split('ASÍ SÍ:')[1] ?? ''
    expect(bien.split('«')[1]?.split('»')[0]?.split(/\s+/).length ?? 99).toBeLessThanOrEqual(25)
  })

  it('el stock manda, y tiene su propia sección', () => {
    expect(PROMPT_HABLADO).toContain('PRIMERO LO QUE SE PUEDE ENTREGAR')
    expect(PROMPT_HABLADO).toMatch(/nombrá el que tiene stock/i)
  })

  it('no le pide que dicte los SKU sin que se lo pidan', () => {
    // Dictar «S, P, punto, P, H, dos» en cada respuesta era un tercio de lo
    // que tardaba en hablar, y casi nunca hacía falta.
    expect(PROMPT_HABLADO).toMatch(/Dictarlo letra por letra sólo si/)
  })

  it('el contexto lleva la fecha al final, después de las reglas', () => {
    const c = contextoDeLlamada('lunes, 19 de octubre de 2026')

    expect(c.startsWith(PROMPT_HABLADO)).toBe(true)
    expect(c).toContain('Hoy es lunes, 19 de octubre de 2026.')
  })
})
