import { describe, expect, it } from 'vitest'
import { ubicar } from './ubicarZoom'

/** Una miniatura de 52 px a la izquierda de la pantalla, como en la planilla. */
const mini = (over: Partial<{ left: number; right: number; top: number; height: number }> = {}) => ({
  left: 40,
  right: 92,
  top: 300,
  height: 52,
  ...over,
})

const VENTANA = { ancho: 1440, alto: 900 }
const LADO = 260

describe('dónde se ubica la foto ampliada', () => {
  it('a la derecha de la miniatura, con 12 px de hueco', () => {
    expect(ubicar(mini(), VENTANA, LADO).left).toBe(92 + 12)
  })

  it('centrada verticalmente en la miniatura', () => {
    // 300 + 52/2 − 260/2 = 196
    expect(ubicar(mini(), VENTANA, LADO).top).toBe(196)
  })

  /*
   * El caso por el que esto está separado y probado: con la ventana angosta la
   * tarjeta no entra a la derecha y tiene que pasarse a la izquierda, o queda
   * medio fuera de la pantalla.
   */
  it('si no entra a la derecha, se pasa a la izquierda', () => {
    const angosta = { ancho: 360, alto: 900 }
    const { left } = ubicar(mini({ left: 200, right: 252 }), angosta, LADO)
    expect(left).toBe(8) // 200 − 12 − 260 = −72 → al margen
  })

  it('no se sale por arriba', () => {
    expect(ubicar(mini({ top: 0 }), VENTANA, LADO).top).toBe(8)
  })

  it('no se sale por abajo', () => {
    const { top } = ubicar(mini({ top: 880 }), VENTANA, LADO)
    expect(top).toBe(900 - 260 - 8)
  })

  /* Una ventana más baja que la tarjeta: se pega arriba y no devuelve un
     número negativo, que la pondría fuera de la pantalla. */
  it('con la ventana más baja que la tarjeta, se pega arriba', () => {
    const baja = { ancho: 1440, alto: 200 }
    expect(ubicar(mini(), baja, LADO).top).toBe(8)
  })

  it('nunca devuelve una posición negativa', () => {
    for (const v of [{ ancho: 200, alto: 150 }, { ancho: 1440, alto: 900 }, { ancho: 320, alto: 480 }]) {
      for (const t of [0, 100, 5000]) {
        const { left, top } = ubicar(mini({ top: t }), v, LADO)
        expect(left).toBeGreaterThanOrEqual(0)
        expect(top).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
