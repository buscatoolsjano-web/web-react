import { describe, expect, it } from 'vitest'
import { loQueDijoLaPersona, sinEco } from './eco'
import { SALUDO } from './dicho'

/**
 * El filtro de eco (Fase 85).
 *
 * El caso de la primera prueba es REAL, copiado de una llamada: Cata saludó,
 * el micrófono oyó el parlante, el reconocedor lo transcribió pegado a la
 * pregunta de verdad, y Cata se contestó a sí misma.
 */
describe('lo que oyó el micrófono mientras Cata hablaba', () => {
  it('el caso que lo rompió: el saludo transcripto, con una pregunta pegada al final', () => {
    const oido =
      'Pregúntame por cualquier producto Del catálogo si lo tenemos A cuánto está ese ariestón'

    expect(loQueDijoLaPersona(oido, SALUDO)).toBe('ese ariestón')
  })

  it('el saludo solo, sin nadie hablando encima, no es un turno', () => {
    const oido = 'Pregúntame por cualquier producto del catálogo si lo tenemos a cuánto está'
    expect(loQueDijoLaPersona(oido, SALUDO)).toBe('')
  })

  it('aunque vuelva con los acentos y las mayúsculas cambiados', () => {
    // La transcripción nunca devuelve el mismo texto: parte «preguntame» en
    // «Pregúntame», se come la puntuación y arranca con mayúscula.
    expect(loQueDijoLaPersona('Preguntame Por Cualquier Producto Del Catalogo', SALUDO)).toBe('')
  })

  it('aunque se saltee palabras del medio', () => {
    expect(loQueDijoLaPersona('preguntame por producto catálogo si lo tenemos', SALUDO)).toBe('')
  })

  it('una interrupción de verdad pasa entera', () => {
    const dicho = 'tenés la PH2 de Speedrill, encastre un cuarto hexagonal, un dólar con ochenta'
    expect(loQueDijoLaPersona('no, mejor la del tres', dicho)).toBe('no, mejor la del tres')
  })

  it('una interrupción que empieza repitiendo lo que ella dijo NO se recorta', () => {
    // «doce dólares» coinciden, pero son dos palabras: con el piso de tres,
    // eso es casualidad y no el parlante. Sin el piso, esto quedaba en
    // «carísimo» y de ahí en nada.
    const dicho = 'tenés el VPPH1/70 a doce dólares, quedan quinientos cuarenta y cuatro'
    expect(loQueDijoLaPersona('doce dólares carísimo', dicho)).toBe('doce dólares carísimo')
  })

  it('una pregunta que repite palabras sueltas del saludo pasa entera', () => {
    // «y del catálogo de Ingersoll» tiene varias palabras del saludo, pero
    // desordenadas: no es el parlante repitiéndose, es alguien preguntando.
    expect(loQueDijoLaPersona('y del catálogo de Ingersoll', SALUDO)).toBe(
      'y del catálogo de Ingersoll',
    )
  })

  it('con Cata callada, todo lo que se oye es de la persona', () => {
    expect(loQueDijoLaPersona('necesito una punta Phillips 2', '')).toBe(
      'necesito una punta Phillips 2',
    )
    expect(loQueDijoLaPersona('hola', '   ')).toBe('hola')
  })

  it('el eco con una palabra de más tampoco es alguien hablando', () => {
    // El propio eco mal transcripto: una palabra suelta que no estaba. No es
    // una intención, es ruido.
    const dicho = 'tenés cuatrocientas disponibles'
    expect(loQueDijoLaPersona('tenés cuatrocientas disponibles eh', dicho)).toBe('')
  })

  it('aguanta el vacío por los dos lados', () => {
    expect(loQueDijoLaPersona('', SALUDO)).toBe('')
    expect(loQueDijoLaPersona('', '')).toBe('')
  })
})

describe('sinEco', () => {
  it('saca el prefijo que coincide y deja el resto tal cual, con su puntuación', () => {
    expect(sinEco('hola soy Cata. Dale, la del 3', 'hola soy Cata')).toBe('Dale, la del 3')
  })

  it('no saca palabras sueltas del medio: sólo el prefijo', () => {
    expect(sinEco('hola soy Cata y el resto no coincide', 'hola soy Cata')).toBe(
      'y el resto no coincide',
    )
  })

  it('si no coincide nada, devuelve todo', () => {
    expect(sinEco('necesito una punta', 'tenés cuatrocientas disponibles')).toBe(
      'necesito una punta',
    )
  })
})
