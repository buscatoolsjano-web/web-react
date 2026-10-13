import { describe, expect, it } from 'vitest'
import {
  MAX_CONTENIDO_PX,
  MIN_CONTENIDO_PX,
  anchoNecesario,
  anchosQueSoloCrecen,
  mismasColumnas,
} from './anchoPorContenido'

describe('anchoNecesario', () => {
  /*
   * EL CASO DEL PEDIDO. «Serie» tiene tres series de tres letras y ocupaba
   * 220 px fijos, los mismos que «Modelo». Ahora tiene que quedar MUCHO más
   * angosta que antes.
   */
  it('una columna de datos cortos queda angosta', () => {
    const px = anchoNecesario({ cabecera: 34, valores: [24, 24, 22], filtro: 40 })
    expect(px).toBeLessThan(120)
  })

  it('una columna de datos largos se ensancha para contenerlos', () => {
    const angosta = anchoNecesario({ cabecera: 50, valores: [30] })
    const ancha = anchoNecesario({ cabecera: 50, valores: [30, 260] })
    expect(ancha).toBeGreaterThan(angosta)
  })

  /*
   * EL ENCABEZADO MANDA CUANDO ES MÁS LARGO QUE EL DATO, y es el caso de
   * «Torque mín. Nm» contra «13 Nm». La regla literal del pedido —el ancho
   * del dato— mostraría «Torq…» y nadie sabría de qué columna se trata.
   */
  it('el encabezado largo gana sobre el dato corto', () => {
    const px = anchoNecesario({ cabecera: 180, valores: [30, 32] })
    expect(px).toBeGreaterThan(180)
  })

  /*
   * Y EL FILTRO TAMBIÉN, porque es un `<select>` y uno de 40 px no se puede
   * ni abrir.
   */
  it('el filtro impone su mínimo aunque el dato y el encabezado sean cortos', () => {
    const sinFiltro = anchoNecesario({ cabecera: 30, valores: [20] })
    const conFiltro = anchoNecesario({ cabecera: 30, valores: [20], filtro: 150 })
    expect(conFiltro).toBeGreaterThan(sinFiltro)
    expect(conFiltro).toBeGreaterThan(150)
  })

  it('siempre deja aire: el texto nunca queda pegado al borde', () => {
    expect(anchoNecesario({ cabecera: 0, valores: [200] })).toBeGreaterThan(200)
  })

  it('sin valores no se rompe: queda el ancho del encabezado', () => {
    const px = anchoNecesario({ cabecera: 100, valores: [] })
    expect(px).toBeGreaterThan(100)
    expect(Number.isFinite(px)).toBe(true)
  })

  it('nunca baja del mínimo legible ni pasa del tope', () => {
    expect(anchoNecesario({ cabecera: 1, valores: [1] })).toBe(MIN_CONTENIDO_PX)
    expect(anchoNecesario({ cabecera: 5000, valores: [9000] })).toBe(MAX_CONTENIDO_PX)
  })

  /*
   * El tope existe para que UNA fila con un valor larguísimo no decida el
   * ancho de las otras cuarenta y nueve. A partir de ahí se corta con puntos
   * suspensivos, que es lo que la tabla ya hacía.
   */
  it('un valor enorme suelto no se lleva la tabla puesta', () => {
    expect(anchoNecesario({ cabecera: 40, valores: [30, 30, 4000] })).toBe(MAX_CONTENIDO_PX)
  })

  it('devuelve enteros: medio píxel de ancho de columna no existe', () => {
    const px = anchoNecesario({ cabecera: 77.3, valores: [101.7] })
    expect(Number.isInteger(px)).toBe(true)
  })
})

describe('anchosQueSoloCrecen', () => {
  /*
   * POR QUÉ SÓLO CRECEN. Se mide lo que se ve, o sea la página actual. Sin
   * esto, un modelo largo en la página 5 ensancharía la columna y volver a la
   * 4 la angostaría: moverse por el listado reacomodaría la tabla en cada
   * paso.
   */
  it('al pasar de página la columna no se angosta', () => {
    const pagina4 = { modelo: 180, serie: 70 }
    const pagina5 = anchosQueSoloCrecen(pagina4, { modelo: 240, serie: 70 })
    expect(pagina5).toEqual({ modelo: 240, serie: 70 })

    const vuelveALa4 = anchosQueSoloCrecen(pagina5, { modelo: 180, serie: 70 })
    expect(vuelveALa4['modelo']).toBe(240)
  })

  it('una columna nueva estrena su medida', () => {
    expect(anchosQueSoloCrecen({ modelo: 200 }, { modelo: 180, torque: 90 })).toEqual({
      modelo: 200,
      torque: 90,
    })
  })

  /* Lo que ya no está no se arrastra: si la columna se fue, su ancho también. */
  it('una columna que desapareció no queda colgada', () => {
    expect(anchosQueSoloCrecen({ modelo: 200, viejo: 300 }, { modelo: 180 })).toEqual({
      modelo: 200,
    })
  })
})

describe('mismasColumnas', () => {
  it('reconoce el mismo juego de columnas', () => {
    expect(mismasColumnas(['a', 'b'], ['a', 'b'])).toBe(true)
  })

  /*
   * Cambiar de categoría cambia los atributos que se muestran, y ahí sí
   * corresponde volver a medir desde cero en vez de arrastrar los anchos de
   * unas columnas que ya no están.
   */
  it('detecta que cambiaron las columnas', () => {
    expect(mismasColumnas(['a', 'b'], ['a', 'c'])).toBe(false)
    expect(mismasColumnas(['a'], ['a', 'b'])).toBe(false)
    expect(mismasColumnas(['a', 'b'], ['b', 'a'])).toBe(false)
  })
})

/*
 * ── LOS TRES NÚMEROS, CONTRA LA TABLA REAL ──────────────────────────────────
 *
 * Están medidos en el navegador sobre el catálogo: padding 8+8, flecha de
 * ordenar 27 px, y un `<select>` que le suma ~30 a su opción más larga.
 *
 * La primera versión los supuso (24 y 22) y daba el resultado correcto por
 * compensación: sobraban 8 de padding y faltaban 5 de flecha. Estos casos
 * fijan cada uno por separado, así el día que alguien corrija el padding no
 * descubra de golpe que los títulos se cortan.
 */
describe('los márgenes, contra lo medido en la tabla', () => {
  it('una columna mandada por su dato le suma sólo el padding', () => {
    // «1/2 Cuadrado» mide 73 px en la tabla y su columna salió 89.
    expect(anchoNecesario({ cabecera: 45, valores: [73] })).toBe(73 + 16)
  })

  it('una columna mandada por su título le deja lugar a la flecha', () => {
    // «Torque mín. Nm» mide 88 px, la flecha 27, el padding 16: 131 en pantalla.
    expect(anchoNecesario({ cabecera: 88, valores: [42] })).toBe(88 + 28 + 16)
  })

  it('el título cabe entero: nunca menos que texto + flecha + padding', () => {
    for (const cab of [30, 60, 88, 97, 150]) {
      expect(anchoNecesario({ cabecera: cab, valores: [10] })).toBeGreaterThanOrEqual(
        Math.min(MAX_CONTENIDO_PX, cab + 27 + 16),
      )
    }
  })

  it('el filtro cabe entero: nunca menos que su opción más larga más su flecha', () => {
    expect(anchoNecesario({ cabecera: 20, valores: [10], filtro: 120 })).toBeGreaterThanOrEqual(120 + 30 + 16)
  })
})
