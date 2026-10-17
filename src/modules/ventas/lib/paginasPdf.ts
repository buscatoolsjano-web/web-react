/**
 * Dónde se corta la hoja para repartirla en páginas (Fase 84).
 *
 * El PDF que se adjunta al mail es una foto de la MISMA hoja que se ve en
 * pantalla y que sale impresa: se la fotografía entera y se la reparte en
 * páginas A4. Esto decide por dónde cortar.
 *
 * La regla es una sola: **no partir un renglón al medio**. El corte natural es
 * «hasta donde entre», pero si ahí justo hay una fila de producto, la mitad de
 * arriba queda en una página y la de abajo en la siguiente, que es lo que hace
 * que un PDF se vea roto. Así que se corta en el último borde de fila que
 * entre en la página, y la fila entera baja.
 *
 * Esto es una función aparte y no dos líneas adentro del generador porque es
 * la única parte del PDF que se puede probar: lo demás es dibujar en un canvas
 * y eso sólo lo sabe un navegador de verdad.
 */

/** Menos de esto sobrando no justifica una página más. */
const TOLERANCIA = 1

export interface CorteDePagina {
  /** Desde dónde empieza esta página, en píxeles de la foto. */
  desde: number
  /** Hasta dónde llega. */
  hasta: number
}

/**
 * Reparte `altoTotal` en páginas de `altoPagina`, cortando en `limites`.
 *
 * `limites` son los bordes por los que SÍ se puede cortar —el final de cada
 * fila de la tabla—. No hace falta que estén ordenados ni que sean únicos.
 * Si no hay ninguno utilizable para una página, se corta a lo bruto: una fila
 * más alta que una página entera no se puede respetar, y es mejor partirla que
 * entrar en un bucle infinito.
 */
export function cortesDePagina(
  altoTotal: number,
  altoPagina: number,
  limites: readonly number[] = [],
): CorteDePagina[] {
  if (!(altoTotal > 0) || !(altoPagina > 0)) return []

  const ordenados = [...new Set(limites)].filter((l) => Number.isFinite(l) && l > 0).sort((a, b) => a - b)
  const paginas: CorteDePagina[] = []
  let desde = 0

  while (altoTotal - desde > TOLERANCIA) {
    const resto = altoTotal - desde
    if (resto <= altoPagina + TOLERANCIA) {
      paginas.push({ desde, hasta: altoTotal })
      break
    }
    const objetivo = desde + altoPagina
    // El último borde que entra en la página y además avanza: si el único que
    // hay es el principio de la página, no sirve —dejaría una página vacía—.
    const candidatos = ordenados.filter((l) => l > desde && l <= objetivo)
    const hasta = candidatos.length > 0 ? candidatos[candidatos.length - 1]! : objetivo
    paginas.push({ desde, hasta })
    desde = hasta
  }

  return paginas
}
