import { describe, expect, it } from 'vitest'
import {
  colorDeFondo,
  distanciaDeColor,
  encuadre,
  LADO_FOTO,
  quitarFondoPorContiguidad,
  recorteDelContenido,
} from './fotoProducto'

/**
 * La foto del producto: mismo tamaño para todas y el fondo afuera (Fase 40).
 *
 * Se prueban las partes que deciden, no el canvas: el canvas no existe en
 * jsdom y probarlo con un mock no probaría nada. Lo que sí se puede probar —y
 * es donde están las decisiones— es cómo se detecta el fondo, qué se borra y
 * qué no, y dónde cae la imagen dentro del cuadrado.
 */

/** Una imagen de prueba: `pintar(x, y)` devuelve el color de cada píxel. */
function imagen(
  ancho: number,
  alto: number,
  pintar: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const datos = new Uint8ClampedArray(ancho * alto * 4)
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = (y * ancho + x) * 4
      const [r, g, b] = pintar(x, y)
      datos[i] = r
      datos[i + 1] = g
      datos[i + 2] = b
      datos[i + 3] = 255
    }
  }
  return datos
}

const alfa = (datos: Uint8ClampedArray, ancho: number, x: number, y: number) =>
  datos[(y * ancho + x) * 4 + 3]

const BLANCO: [number, number, number] = [255, 255, 255]
const NEGRO: [number, number, number] = [10, 10, 10]

describe('Detectar el fondo', () => {
  it('sale de las esquinas, no de suponer que es blanco', () => {
    // Fondo gris claro, como vienen la mitad de las fotos de proveedor.
    const datos = imagen(10, 10, () => [230, 230, 230])
    expect(colorDeFondo(datos, 10, 10)).toEqual([230, 230, 230])
  })

  /**
   * Se toma la MEDIANA de las cuatro esquinas: si una cae sobre el producto
   * —pasa cuando la foto viene recortada al ras— el promedio se corrompería y
   * la mediana no.
   */
  it('una esquina tapada por el producto no arrastra el resultado', () => {
    const datos = imagen(10, 10, (x, y) => (x === 0 && y === 0 ? NEGRO : BLANCO))
    expect(colorDeFondo(datos, 10, 10)).toEqual([255, 255, 255])
  })

  it('la distancia entre colores es la del cubo RGB', () => {
    expect(distanciaDeColor([0, 0, 0], [0, 0, 0])).toBe(0)
    expect(distanciaDeColor([255, 255, 255], [255, 255, 255])).toBe(0)
    expect(Math.round(distanciaDeColor([0, 0, 0], [255, 0, 0]))).toBe(255)
  })
})

describe('Quitar el fondo', () => {
  /** Un producto oscuro centrado sobre fondo blanco: el caso de catálogo. */
  const conProducto = () =>
    imagen(20, 20, (x, y) => (x >= 6 && x < 14 && y >= 6 && y < 14 ? NEGRO : BLANCO))

  it('borra el fondo y deja el producto intacto', () => {
    const datos = conProducto()
    const { opacos } = quitarFondoPorContiguidad(datos, 20, 20)

    expect(alfa(datos, 20, 0, 0)).toBe(0)
    expect(alfa(datos, 20, 19, 19)).toBe(0)
    expect(alfa(datos, 20, 10, 10)).toBe(255)
    // El producto son 8 × 8 = 64 píxeles, y son los únicos que quedan en pie.
    expect(opacos).toBe(64)
  })

  /**
   * La razón de que sea por contigüidad y no «borrar todos los píxeles
   * blancos»: un producto con una etiqueta blanca, o con un brillo, quedaría
   * agujereado. Sólo se saca lo que está pegado al borde.
   */
  it('el blanco ENCERRADO dentro del producto no se toca', () => {
    const datos = imagen(20, 20, (x, y) => {
      const dentro = x >= 5 && x < 15 && y >= 5 && y < 15
      if (!dentro) return BLANCO
      // Una etiqueta blanca en el medio del producto.
      return x >= 9 && x < 11 && y >= 9 && y < 11 ? BLANCO : NEGRO
    })
    quitarFondoPorContiguidad(datos, 20, 20)

    expect(alfa(datos, 20, 0, 0)).toBe(0)
    expect(alfa(datos, 20, 9, 9)).toBe(255)
  })

  /** Un gris apenas distinto del fondo sigue siendo fondo: la foto tiene ruido. */
  it('tolera el ruido del fondo', () => {
    const datos = imagen(20, 20, (x, y) =>
      x >= 8 && x < 12 && y >= 8 && y < 12 ? NEGRO : [252, 250, 253],
    )
    quitarFondoPorContiguidad(datos, 20, 20)
    expect(alfa(datos, 20, 0, 0)).toBe(0)
  })

  /**
   * Una foto sin fondo liso: el relleno se come casi todo. No se rompe nada,
   * y es el dato con el que la pantalla decide avisar en vez de guardar una
   * foto vacía.
   */
  it('sobre una foto sin fondo liso avisa quedándose sin píxeles', () => {
    const datos = imagen(20, 20, () => [200, 200, 200])
    const { opacos } = quitarFondoPorContiguidad(datos, 20, 20)
    expect(opacos).toBe(0)
  })
})

describe('Dónde quedó el producto', () => {
  it('el recorte es la caja de lo que sigue opaco', () => {
    const datos = imagen(20, 20, (x, y) => (x >= 6 && x < 14 && y >= 4 && y < 10 ? NEGRO : BLANCO))
    quitarFondoPorContiguidad(datos, 20, 20)
    expect(recorteDelContenido(datos, 20, 20)).toEqual({ x: 6, y: 4, ancho: 8, alto: 6 })
  })

  it('sin nada opaco no hay recorte, y se dice con null', () => {
    const datos = imagen(10, 10, () => BLANCO)
    quitarFondoPorContiguidad(datos, 10, 10)
    expect(recorteDelContenido(datos, 10, 10)).toBeNull()
  })
})

describe('El encuadre en el cuadrado', () => {
  it('una foto cuadrada entra entera y centrada, con margen', () => {
    const c = encuadre(1000, 1000)
    expect(c.ancho).toBe(c.alto)
    // Entra entera: nunca más grande que el cuadrado.
    expect(c.ancho).toBeLessThan(LADO_FOTO)
    expect(c.x).toBeCloseTo((LADO_FOTO - c.ancho) / 2, 5)
  })

  /** Entra entera: una foto apaisada no se recorta, se centra. */
  it('una foto apaisada conserva su proporción', () => {
    const c = encuadre(2000, 1000)
    expect(c.ancho / c.alto).toBeCloseTo(2, 5)
    expect(c.ancho).toBeLessThanOrEqual(LADO_FOTO)
    expect(c.alto).toBeLessThanOrEqual(LADO_FOTO)
    expect(c.y).toBeGreaterThan(c.x)
  })

  it('una foto chica se agranda hasta llenar el cuadro', () => {
    const c = encuadre(50, 50)
    expect(c.ancho).toBeGreaterThan(50)
  })
})
