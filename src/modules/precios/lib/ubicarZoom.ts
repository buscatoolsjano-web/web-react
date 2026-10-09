/** Lo que mide la tarjeta. Tiene que coincidir con el CSS de `ZoomDeFoto`. */
export const LADO = 260

/** Separación entre la miniatura y la tarjeta. */
export const HUECO = 12

/**
 * Dónde poner la tarjeta, dado el rectángulo de la miniatura.
 *
 * Separada y exportada para poder probarla: es la parte con cuentas, y el
 * borde de la ventana es justo donde se rompe. Trabaja en coordenadas de la
 * ventana, las mismas que devuelve `getBoundingClientRect`.
 */
export function ubicar(
  ancla: { left: number; right: number; top: number; height: number },
  ventana: { ancho: number; alto: number } = { ancho: window.innerWidth, alto: window.innerHeight },
  lado = LADO,
): { left: number; top: number } {
  const margen = 8

  const aLaDerecha = ancla.right + HUECO
  const cabeDerecha = aLaDerecha + lado + margen <= ventana.ancho
  const left = cabeDerecha ? aLaDerecha : Math.max(margen, ancla.left - HUECO - lado)

  // Centrada verticalmente en la miniatura, sin salirse de la ventana.
  const ideal = ancla.top + ancla.height / 2 - lado / 2
  const top = Math.min(Math.max(margen, ideal), Math.max(margen, ventana.alto - lado - margen))

  return { left, top }
}
