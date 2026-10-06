/**
 * La foto del producto: mismo tamaño para todas, y el fondo afuera (Fase 40).
 *
 * El catálogo se ve desprolijo cuando cada foto viene de un lado: una de
 * 2.400 px sacada con el teléfono, otra de 180 px bajada de un PDF, una con
 * fondo blanco y otra con el escritorio de fondo. En la grilla se nota todo
 * junto.
 *
 * Dos cosas, las dos en el navegador y antes de subir nada:
 *
 *  · **500 × 500.** La foto entra completa —no se recorta— centrada sobre un
 *    cuadrado, con un margen chico. Lo que sobra se rellena: transparente si
 *    se quitó el fondo, blanco si no.
 *  · **Quitar el fondo.** Esto NO es un recorte inteligente: es un relleno por
 *    contigüidad desde los bordes que saca lo que tenga el color del fondo.
 *    Anda muy bien con la foto de catálogo típica —el producto sobre un fondo
 *    liso— y no hace nada útil con una foto sacada en el taller. Por eso es
 *    opcional, se ve en la vista previa antes de guardar, y el texto de la
 *    pantalla lo dice con todas las letras.
 *
 * Por qué por contigüidad y no «borrar todos los píxeles blancos»: un producto
 * con una etiqueta blanca, o con un brillo, quedaría agujereado. Sólo se saca
 * lo que está pegado al borde.
 */

/** Todas las fotos salen de este tamaño. */
export const LADO_FOTO = 500

/** Margen alrededor del producto, para que no toque el borde del cuadrado. */
const MARGEN = 0.04

/**
 * Cuánto se puede alejar un píxel del color del fondo y seguir siendo fondo.
 *
 * Dos umbrales y no uno: por debajo del primero es fondo seguro y se borra
 * entero; entre los dos se le baja la opacidad en proporción, que es lo que
 * evita el borde dentado de recortar con un sí/no.
 */
const TOLERANCIA_DURA = 28
const TOLERANCIA_SUAVE = 72

export interface OpcionesDeFoto {
  /** Sólo sirve con fondo liso. Lo decide quien carga, mirando la vista previa. */
  quitarFondo: boolean
}

/** Distancia entre dos colores, en el cubo RGB. Alcanza y es barata. */
export function distanciaDeColor(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
}

/**
 * El color del fondo, deducido de las cuatro esquinas.
 *
 * Se toma la MEDIANA y no el promedio: si una esquina cae sobre el producto
 * —pasa cuando la foto viene recortada al ras— el promedio se corrompe y la
 * mediana no. Y se usa el color real en vez de asumir blanco porque la mitad
 * de las fotos de proveedor vienen sobre gris claro.
 */
export function colorDeFondo(datos: Uint8ClampedArray, ancho: number, alto: number): [number, number, number] {
  const esquinas: [number, number][] = [
    [0, 0],
    [ancho - 1, 0],
    [0, alto - 1],
    [ancho - 1, alto - 1],
  ]
  const canales: [number[], number[], number[]] = [[], [], []]
  for (const [x, y] of esquinas) {
    const i = (y * ancho + x) * 4
    canales[0].push(datos[i] ?? 255)
    canales[1].push(datos[i + 1] ?? 255)
    canales[2].push(datos[i + 2] ?? 255)
  }
  return canales.map(mediana) as [number, number, number]
}

function mediana(xs: number[]): number {
  const orden = [...xs].sort((a, b) => a - b)
  const m = orden.length >> 1
  return orden.length % 2 === 1 ? (orden[m] ?? 0) : ((orden[m - 1] ?? 0) + (orden[m] ?? 0)) / 2
}

/**
 * Saca el fondo, empezando por los bordes y avanzando hacia adentro.
 *
 * Modifica `datos` en el lugar: es un ImageData de varios megabytes y copiarlo
 * para devolverlo nuevo no aporta nada.
 *
 * Devuelve cuántos píxeles quedaron opacos, que es con lo que se decide si el
 * resultado sirve: si quedó casi nada, el fondo no era liso y conviene avisar
 * en vez de guardar una foto vacía.
 */
export function quitarFondoPorContiguidad(
  datos: Uint8ClampedArray,
  ancho: number,
  alto: number,
): { opacos: number } {
  const fondo = colorDeFondo(datos, ancho, alto)
  const visitado = new Uint8Array(ancho * alto)
  // Una pila y no recursión: una imagen de 2.400 × 2.400 desborda la de
  // llamadas antes de llegar a la mitad.
  const pila: number[] = []

  const encolarBorde = () => {
    for (let x = 0; x < ancho; x++) {
      pila.push(x, 0, x, alto - 1)
    }
    for (let y = 0; y < alto; y++) {
      pila.push(0, y, ancho - 1, y)
    }
  }
  encolarBorde()

  while (pila.length > 0) {
    const y = pila.pop()!
    const x = pila.pop()!
    if (x < 0 || y < 0 || x >= ancho || y >= alto) continue
    const p = y * ancho + x
    if (visitado[p]) continue
    visitado[p] = 1

    const i = p * 4
    const d = distanciaDeColor([datos[i] ?? 0, datos[i + 1] ?? 0, datos[i + 2] ?? 0], fondo)
    if (d >= TOLERANCIA_SUAVE) continue

    if (d <= TOLERANCIA_DURA) {
      datos[i + 3] = 0
    } else {
      // La franja de transición: alfa proporcional a lo lejos que está del
      // fondo. Es lo que evita el borde dentado.
      const t = (d - TOLERANCIA_DURA) / (TOLERANCIA_SUAVE - TOLERANCIA_DURA)
      datos[i + 3] = Math.round((datos[i + 3] ?? 255) * t)
    }

    pila.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1)
  }

  let opacos = 0
  for (let i = 3; i < datos.length; i += 4) {
    if ((datos[i] ?? 0) > 16) opacos++
  }
  return { opacos }
}

export interface Recorte {
  x: number
  y: number
  ancho: number
  alto: number
}

/**
 * El rectángulo que ocupa lo que quedó opaco.
 *
 * Sirve para que el producto llene el cuadrado: dos fotos del mismo producto,
 * una con mucho aire alrededor y otra al ras, terminan del mismo tamaño en la
 * grilla. Sólo se usa cuando se quitó el fondo, porque es lo único que permite
 * saber qué es producto y qué no.
 */
export function recorteDelContenido(
  datos: Uint8ClampedArray,
  ancho: number,
  alto: number,
): Recorte | null {
  let x0 = ancho
  let y0 = alto
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if ((datos[(y * ancho + x) * 4 + 3] ?? 0) > 16) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < x0 || y1 < y0) return null
  return { x: x0, y: y0, ancho: x1 - x0 + 1, alto: y1 - y0 + 1 }
}

/** Dónde va la imagen dentro del cuadrado: entera, centrada y con margen. */
export function encuadre(
  anchoOrigen: number,
  altoOrigen: number,
  lado = LADO_FOTO,
): { x: number; y: number; ancho: number; alto: number } {
  const util = lado * (1 - MARGEN * 2)
  const escala = Math.min(util / anchoOrigen, util / altoOrigen)
  const ancho = anchoOrigen * escala
  const alto = altoOrigen * escala
  return { x: (lado - ancho) / 2, y: (lado - alto) / 2, ancho, alto }
}

export interface FotoNormalizada {
  archivo: File
  /** `true` si se pidió quitar el fondo y quedó algo razonable. */
  fondoQuitado: boolean
  /** Para avisar: se pidió quitar el fondo y no quedó casi nada. */
  casiVacia: boolean
}

/**
 * Deja la foto lista para subir: 500 × 500 y, si se pidió, sin fondo.
 *
 * Sale en WEBP porque es el único de los formatos que acepta el bucket que
 * tiene transparencia y además pesa poco. Un JPG no puede guardar el fondo
 * quitado —lo rellenaría de negro— y un PNG de 500 × 500 pesa varias veces
 * más sin verse mejor.
 */
export async function normalizarFoto(archivo: File, opciones: OpcionesDeFoto): Promise<FotoNormalizada> {
  const bitmap = await createImageBitmap(archivo)
  try {
    const trabajo = document.createElement('canvas')
    trabajo.width = bitmap.width
    trabajo.height = bitmap.height
    const ctx = trabajo.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('El navegador no pudo procesar la imagen.')
    ctx.drawImage(bitmap, 0, 0)

    let fondoQuitado = false
    let casiVacia = false
    let recorte: Recorte | null = null

    if (opciones.quitarFondo) {
      const datos = ctx.getImageData(0, 0, trabajo.width, trabajo.height)
      const { opacos } = quitarFondoPorContiguidad(datos.data, trabajo.width, trabajo.height)
      const total = trabajo.width * trabajo.height
      // Menos del 1 % en pie significa que el «fondo» se comió el producto:
      // la foto no tenía fondo liso. Se avisa y se guarda igual sin tocarla.
      casiVacia = opacos < total * 0.01
      if (!casiVacia) {
        ctx.putImageData(datos, 0, 0)
        recorte = recorteDelContenido(datos.data, trabajo.width, trabajo.height)
        fondoQuitado = true
      }
    }

    const origen = recorte ?? { x: 0, y: 0, ancho: trabajo.width, alto: trabajo.height }
    const salida = document.createElement('canvas')
    salida.width = LADO_FOTO
    salida.height = LADO_FOTO
    const ctxSalida = salida.getContext('2d')
    if (!ctxSalida) throw new Error('El navegador no pudo procesar la imagen.')

    // Sin fondo quitado el relleno es BLANCO y no transparente: las fotos de
    // catálogo vienen sobre blanco, y dejarlo transparente haría que el
    // producto apareciera sobre el color de cada pantalla donde se muestre.
    if (!fondoQuitado) {
      ctxSalida.fillStyle = '#ffffff'
      ctxSalida.fillRect(0, 0, LADO_FOTO, LADO_FOTO)
    }

    ctxSalida.imageSmoothingQuality = 'high'
    const caja = encuadre(origen.ancho, origen.alto)
    ctxSalida.drawImage(
      trabajo,
      origen.x,
      origen.y,
      origen.ancho,
      origen.alto,
      caja.x,
      caja.y,
      caja.ancho,
      caja.alto,
    )

    const blob = await new Promise<Blob | null>((resolve) =>
      salida.toBlob(resolve, 'image/webp', 0.92),
    )
    if (!blob) throw new Error('El navegador no pudo guardar la imagen.')

    const nombre = archivo.name.replace(/\.[^.]+$/, '') || 'foto'
    return {
      archivo: new File([blob], `${nombre}.webp`, { type: 'image/webp' }),
      fondoQuitado,
      casiVacia,
    }
  } finally {
    bitmap.close()
  }
}
