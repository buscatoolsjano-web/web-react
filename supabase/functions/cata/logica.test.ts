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
  contextoDeLlamada,
  DE_MAS,
  esDeCata,
  herramientasDelAgente,
  HERRAMIENTAS_DE_CATA,
  PROMPT_HABLADO,
  soloCatalogo,
} from './logica'

describe('la lista blanca', () => {
  it('son las del catálogo, más el costo que se pidió aparte', () => {
    expect([...HERRAMIENTAS_DE_CATA].sort()).toEqual([
      'buscar_productos',
      'ficha_producto',
      'resumen_catalogo',
      'stock_actual',
      'ultimo_costo',
    ])
  })

  it('todas existen de verdad en el catálogo de herramientas', () => {
    // Un nombre mal escrito en la lista blanca no rompe nada visible: la
    // herramienta sencillamente nunca se ejecuta y Cata contesta que no sabe.
    const nombres = HERRAMIENTAS.map((h) => h.id)
    for (const n of HERRAMIENTAS_DE_CATA) expect(nombres).toContain(n)
  })

  it('no deja entrar ninguna que lea clientes, documentos o correos', () => {
    // Al revés que el anterior: recorre TODAS las herramientas de la casa y
    // comprueba que las que no son de catálogo quedan afuera. Así una
    // herramienta nueva —`buscar_clientes_v2`— no entra por olvido.
    const deCatalogo = new Set(HERRAMIENTAS_DE_CATA)
    for (const h of HERRAMIENTAS) {
      if (deCatalogo.has(h.id)) continue
      expect(esDeCata(h.id)).toBe(false)
    }
  })

  it('tiene TODAS las del agente que contesta', () => {
    // Al revés sería peor que un error: el agente ofrecería al modelo una
    // herramienta que después rebota, y Cata contestaría «no puedo» sobre algo
    // que sí es de catálogo.
    for (const h of herramientasDelAgente()) expect(HERRAMIENTAS_DE_CATA).toContain(h)
  })

  it('y lo que tiene DE MÁS está puesto a mano, una por una', () => {
    // Si alguien le agrega al agente `catalogo` una herramienta que no es de
    // catálogo —los precios de un cliente «son de catálogo» hasta que uno lo
    // piensa—, Cata no se la gana sola: este test falla y alguien decide.
    const delAgente = new Set(herramientasDelAgente())
    const extra = HERRAMIENTAS_DE_CATA.filter((h) => !delAgente.has(h))
    expect([...extra].sort()).toEqual([...DE_MAS].sort())
  })

  it('lo de más no es de clientes ni de documentos', () => {
    // `ultimo_costo` es un dato del PRODUCTO, no de un cliente. Es la única
    // razón por la que se le puede dar a un teléfono que no sabe de clientes.
    expect(DE_MAS).toEqual(['ultimo_costo'])
  })

  it('el agente que contesta existe', () => {
    expect(herramientasDelAgente().length).toBeGreaterThan(0)
    expect(AGENTE_DE_CATA).toBe('catalogo')
  })
})

describe('soloCatalogo', () => {
  it('deja pasar las de la lista, con sus argumentos intactos', async () => {
    const adentro = vi.fn(async () => 'listo')
    const ejecutar = soloCatalogo(adentro)

    await expect(ejecutar('buscar_productos', { texto: 'punta ph1' })).resolves.toBe('listo')
    expect(adentro).toHaveBeenCalledWith('buscar_productos', { texto: 'punta ph1' })
  })

  it('rebota las que no están y NI SIQUIERA llama al ejecutor', async () => {
    const adentro = vi.fn(async () => 'no tendría que verse esto')
    const ejecutar = soloCatalogo(adentro)

    const r = await ejecutar('buscar_clientes', { texto: 'Mirgor' })

    expect(adentro).not.toHaveBeenCalled()
    expect(JSON.parse(r)).toMatchObject({ problema: expect.stringContaining('buscar_clientes') })
  })

  it('rebota también una herramienta inventada', async () => {
    const adentro = vi.fn(async () => 'nada')
    const r = await soloCatalogo(adentro)('leer_todo', {})

    expect(adentro).not.toHaveBeenCalled()
    expect(r).toContain('problema')
  })

  it('el rebote vuelve como texto y no como excepción', async () => {
    // Lanzar le cortaría la llamada a quien está del otro lado del teléfono.
    const r = soloCatalogo(async () => 'nada')('crear_cotizacion', {})
    await expect(r).resolves.toEqual(expect.any(String))
  })

  it('no se traga el fallo del ejecutor de adentro', async () => {
    const adentro = async () => JSON.stringify({ problema: 'no encontré ese SKU' })
    const r = await soloCatalogo(adentro)('ficha_producto', { sku: 'XX' })
    expect(JSON.parse(r)).toEqual({ problema: 'no encontré ese SKU' })
  })
})

describe('el prompt hablado', () => {
  it('prohíbe los asteriscos, que es lo que PROMPT_COMUN permite', () => {
    expect(PROMPT_HABLADO).toContain('asterisco')
  })

  it('dice de qué no sabe', () => {
    for (const tema of ['cliente', 'cotización', 'correo']) {
      expect(PROMPT_HABLADO).toContain(tema)
    }
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

  it('el contexto lleva la fecha al final, después de las reglas', () => {
    const c = contextoDeLlamada('lunes, 19 de octubre de 2026')

    expect(c.startsWith(PROMPT_HABLADO)).toBe(true)
    expect(c).toContain('Hoy es lunes, 19 de octubre de 2026.')
  })
})
