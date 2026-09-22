import { describe, expect, it } from 'vitest'
import { ANCHO_POPOVER, ubicar } from './ubicarPopover'

/**
 * Dónde se ubica la ficha al vuelo (Fase 22 · Etapa B).
 *
 * Lo que se prueba es una sola cosa, en los nueve anchos: que la ficha **nunca
 * se salga de la pantalla**. Si `left` es negativo o el borde derecho pasa del
 * viewport, el navegador le agrega scroll horizontal a la página entera, y el
 * listado se corre solo cuando uno pasa el mouse. Es el bug más molesto de un
 * popover y no se ve hasta que pasa.
 */
const rect = (x: number, y: number, w = 48, h = 48): DOMRect =>
  ({ x, y, left: x, top: y, right: x + w, bottom: y + h, width: w, height: h }) as DOMRect

const ANCHOS = [375, 390, 430, 768, 1024, 1280, 1440, 1600, 1920]
const ALTO_VENTANA = 800
const ALTO_FICHA = 520

describe('Nunca genera scroll horizontal de página', () => {
  it.each(ANCHOS)('a %i px, pegada al borde izquierdo', (vw) => {
    const u = ubicar(rect(8, 300), ALTO_FICHA, vw, ALTO_VENTANA)
    expect(u.izquierda).toBeGreaterThanOrEqual(0)
    expect(u.izquierda + u.ancho).toBeLessThanOrEqual(vw)
  })

  it.each(ANCHOS)('a %i px, pegada al borde derecho', (vw) => {
    const u = ubicar(rect(vw - 60, 300), ALTO_FICHA, vw, ALTO_VENTANA)
    expect(u.izquierda).toBeGreaterThanOrEqual(0)
    expect(u.izquierda + u.ancho).toBeLessThanOrEqual(vw)
  })

  it.each(ANCHOS)('a %i px, en el medio', (vw) => {
    const u = ubicar(rect(Math.round(vw / 2), 300), ALTO_FICHA, vw, ALTO_VENTANA)
    expect(u.izquierda).toBeGreaterThanOrEqual(0)
    expect(u.izquierda + u.ancho).toBeLessThanOrEqual(vw)
  })
})

describe('Prefiere la derecha, cae a la izquierda (B2)', () => {
  it('con lugar de sobra abre a la derecha de la miniatura', () => {
    const u = ubicar(rect(100, 300), ALTO_FICHA, 1920, ALTO_VENTANA)
    expect(u.lado).toBe('derecha')
    expect(u.izquierda).toBe(160) // 100 + 48 + 12
  })

  it('cerca del borde derecho se da vuelta', () => {
    const u = ubicar(rect(1800, 300), ALTO_FICHA, 1920, ALTO_VENTANA)
    expect(u.lado).toBe('izquierda')
  })

  it('el punto de quiebre es cuando deja de entrar, no antes', () => {
    // 700 de ficha + 12 de margen a cada lado: entra hasta que el ancla
    // termina en 1920 - 724 = 1196.
    expect(ubicar(rect(1148, 300), ALTO_FICHA, 1920, ALTO_VENTANA).lado).toBe('derecha')
    expect(ubicar(rect(1160, 300), ALTO_FICHA, 1920, ALTO_VENTANA).lado).toBe('izquierda')
  })
})

describe('Se angosta antes que desbordar', () => {
  it('en 375 px no mantiene los 700 ideales', () => {
    const u = ubicar(rect(20, 300), ALTO_FICHA, 375, ALTO_VENTANA)
    expect(u.ancho).toBeLessThan(ANCHO_POPOVER)
    expect(u.ancho).toBe(375 - 24)
  })

  it('desde 1280 entra entera', () => {
    expect(ubicar(rect(100, 300), ALTO_FICHA, 1280, ALTO_VENTANA).ancho).toBe(ANCHO_POPOVER)
  })
})

describe('Vertical: se centra pero no se sale', () => {
  it('se centra en la miniatura cuando hay lugar', () => {
    const u = ubicar(rect(100, 400, 48, 48), 200, 1920, ALTO_VENTANA)
    expect(u.arriba).toBe(324) // 400 + 24 - 100
  })

  it('arriba de todo no se va a negativo', () => {
    expect(ubicar(rect(100, 0), ALTO_FICHA, 1920, ALTO_VENTANA).arriba).toBeGreaterThanOrEqual(0)
  })

  it('abajo de todo no pasa del borde', () => {
    const u = ubicar(rect(100, 780), ALTO_FICHA, 1920, ALTO_VENTANA)
    expect(u.arriba + ALTO_FICHA).toBeLessThanOrEqual(ALTO_VENTANA)
  })

  it('si la ficha es más alta que la pantalla, gana arriba', () => {
    // Cortar por abajo se recupera con el scroll interno; cortar por arriba
    // esconde el modelo, que es lo único que identifica al producto.
    const u = ubicar(rect(100, 300), 1200, 1920, ALTO_VENTANA)
    expect(u.arriba).toBeGreaterThanOrEqual(0)
  })
})
