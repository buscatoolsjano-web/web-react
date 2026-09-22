/**
 * Dónde entra la ficha al vuelo (Fase 22 · Etapa B).
 *
 * Vive fuera del componente porque es aritmética, no una vista: así se puede
 * probar en los nueve anchos sin montar un navegador.
 */

export const ANCHO_IMAGEN = 300
export const ANCHO_PANEL = 400
export const ANCHO_POPOVER = ANCHO_IMAGEN + ANCHO_PANEL
const MARGEN = 12

export interface Ubicacion {
  izquierda: number
  arriba: number
  lado: 'derecha' | 'izquierda'
  /** El ancho que finalmente entra; más chico que el ideal en pantallas angostas. */
  ancho: number
}

/**
 * A la derecha del ancla si hay lugar, a la izquierda si no, y pegada al borde
 * antes que salirse (B2).
 *
 * Nunca se deja que `left` sea negativo ni que el borde derecho pase del
 * viewport: cualquiera de las dos cosas le agrega scroll horizontal a la
 * PÁGINA, y el listado entero se corre cuando uno pasa el mouse. En una
 * pantalla donde no entran los 700 px, la ficha se angosta en vez de
 * desbordar — prefiero una ficha apretada a un catálogo que salta.
 */
export function ubicar(
  ancla: DOMRect,
  alto: number,
  vw = typeof window === 'undefined' ? 1280 : window.innerWidth,
  vh = typeof window === 'undefined' ? 800 : window.innerHeight,
): Ubicacion {
  const ancho = Math.min(ANCHO_POPOVER, vw - MARGEN * 2)
  const entraDerecha = ancla.right + MARGEN + ancho + MARGEN <= vw
  const crudo = entraDerecha ? ancla.right + MARGEN : ancla.left - ancho - MARGEN
  const izquierda = Math.max(MARGEN, Math.min(crudo, vw - ancho - MARGEN))
  const centrado = ancla.top + ancla.height / 2 - alto / 2
  // Si la ficha es más alta que la pantalla, arriba gana: cortar por abajo se
  // recupera con scroll interno, cortar por arriba esconde el modelo.
  const arriba = Math.max(MARGEN, Math.min(centrado, Math.max(MARGEN, vh - alto - MARGEN)))
  return { izquierda, arriba, lado: entraDerecha ? 'derecha' : 'izquierda', ancho }
}
