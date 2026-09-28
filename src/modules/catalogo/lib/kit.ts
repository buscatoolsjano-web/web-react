import type { CandidatoComponente } from '../services/productos'

/**
 * Una línea de la receta MIENTRAS se edita.
 *
 * No es lo que viaja a la base: `cantidad` es texto porque se está escribiendo,
 * y `fila` existe sólo para que React distinga dos líneas vacías. La conversión
 * pasa al guardar.
 */
export interface ComponenteElegido {
  /** Identidad de la fila en la pantalla; no viaja a la base. */
  fila: string
  producto: CandidatoComponente | null
  /** Texto: se escribe, y recién al guardar se convierte. */
  cantidad: string
}

export const filaVacia = (): ComponenteElegido => ({
  fila: crypto.randomUUID(),
  producto: null,
  cantidad: '1',
})

/**
 * Las líneas que de verdad se pueden guardar: con producto y con una cantidad
 * mayor que cero.
 *
 * Una línea a medio llenar no es un error que deba frenar el alta —es una
 * línea que se agregó y no se completó—, así que se descarta en silencio. Lo
 * que sí frena es que NINGUNA esté completa: un kit sin receta no se puede
 * despachar.
 */
export function componentesUtiles(
  componentes: ComponenteElegido[],
): { productoId: string; cantidad: number }[] {
  return componentes
    .filter((c) => c.producto !== null && Number(c.cantidad) > 0)
    .map((c) => ({ productoId: c.producto!.id, cantidad: Number(c.cantidad) }))
}

/**
 * Cuántos kits se pueden armar: el mínimo de (stock / cantidad de la receta),
 * redondeado para abajo.
 *
 * Es la MISMA cuenta que `public.stock_de_kit` en la base, que es la autoridad.
 * Acá existe para poder mostrarla mientras se arma la receta, sin ir y volver.
 */
export function kitsArmables(lineas: { cantidad: number; stock: number }[]): number {
  if (lineas.length === 0) return 0
  return Math.min(...lineas.map((l) => Math.floor(l.stock / l.cantidad)))
}
