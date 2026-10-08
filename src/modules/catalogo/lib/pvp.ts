/**
 * El PVP derivado del costo del proveedor (Fase 51).
 *
 * LA CUENTA LA HACE LA BASE, en la vista `product_pvp`: así el mismo PVP vale
 * para el catálogo, para una cotización, para un informe y para cualquiera que
 * consulte. Acá se decide qué hacer con ese número, que es lo que necesita una
 * pantalla y no tiene por qué estar en SQL.
 *
 * POR QUÉ NO SE GUARDA. `product_prices` es de STEL: la sincronización nocturna
 * lo reescribe desde su propio `sales-price`. Un PVP guardado ahí duraría hasta
 * la siguiente corrida. Siendo derivado no hay nada que pisar, y además
 * «recalcular todo» pasa solo cada vez que entra una lista nueva.
 *
 * NO SE CONVIERTE MONEDA. El costo de SPEEDRILL está en EUR y el PVP sale en
 * USD, igual que en la planilla que se usa hoy: el múltiplo absorbe el flete,
 * la importación y la diferencia de cambio. Fue una decisión explícita. Meter
 * un tipo de cambio acá cambiaría todos los precios sin que nadie lo pida.
 */

export interface PvpDeProducto {
  productId: string
  /** La referencia tal como la trae la lista del proveedor. */
  reference: string
  /** El costo sobre el que se multiplicó, en `monedaCosto`. */
  costo: number
  monedaCosto: string | null
  /** De qué lista salió el costo. */
  fechaCosto: string | null
  multiplicador: number
  /**
   * `false` cuando la base NO es un costo real sino el precio de venta del
   * proveedor —el caso de TECNA, cuyo archivo no trae costo—.
   *
   * No cambia la cuenta: cambia lo que la pantalla puede afirmar. Un PVP
   * derivado de un costo es un margen; derivado de la venta del proveedor es
   * una referencia, y conviene que se vea la diferencia antes de cotizar.
   */
  baseEsCosto: boolean
  pvp: number
}

/** De dónde salió el precio que se está mostrando o sugiriendo. */
export type OrigenDePrecio = 'formula' | 'tarifa' | 'ninguno'

export interface PrecioResuelto {
  monto: number | null
  origen: OrigenDePrecio
}

/**
 * Qué precio manda: la fórmula o la tarifa de STEL.
 *
 * **La fórmula gana**, y es una decisión tomada con los números a la vista: en
 * SPEEDRILL reproduce exacto la columna de precios de la propia planilla en
 * 3.627 renglones, mientras que los 84 precios que STEL tenía cargados no
 * siguen ninguna regla —van de ×2,33 a ×6,73 sobre el mismo costo—. Lo que no
 * tiene regla es STEL, no la fórmula.
 *
 * Donde no hay costo cargado —unos 18.000 productos— sigue mandando la tarifa,
 * sin ruido: la fórmula no inventa un precio que no puede calcular.
 */
export function resolverPrecio(
  pvp: PvpDeProducto | undefined,
  precioDeTarifa: number | null,
): PrecioResuelto {
  if (pvp) return { monto: pvp.pvp, origen: 'formula' }
  if (precioDeTarifa !== null) return { monto: precioDeTarifa, origen: 'tarifa' }
  return { monto: null, origen: 'ninguno' }
}

/**
 * El margen que deja un PVP sobre su costo, en porcentaje.
 *
 * Es el múltiplo menos uno: ×3 son 200 puntos de margen sobre el costo. Se
 * muestra junto al número para que se entienda qué significa el ×3 sin tener
 * que hacer la cuenta.
 *
 * Devuelve `null` si la base no es un costo real: el «margen» contra el precio
 * de venta de otro no es un margen, y decir que lo es sería mentir en la
 * pantalla donde se decide cuánto cobrar.
 */
export function margenSobreCosto(pvp: PvpDeProducto): number | null {
  if (!pvp.baseEsCosto) return null
  if (!Number.isFinite(pvp.multiplicador) || pvp.multiplicador <= 0) return null
  return Math.round((pvp.multiplicador - 1) * 10000) / 100
}

/**
 * Cómo se explica de dónde salió el precio, en una línea.
 *
 * Un número que aparece solo en un campo de precio es un número en el que
 * nadie confía: hay que poder decir de dónde salió sin salir de la pantalla.
 */
export function explicarPvp(pvp: PvpDeProducto, formatearImporte: (n: number, moneda: string | null) => string): string {
  const base = formatearImporte(pvp.costo, pvp.monedaCosto)
  const que = pvp.baseEsCosto ? 'costo' : 'precio del proveedor'
  const mult = pvp.multiplicador.toLocaleString('es-AR', { maximumFractionDigits: 2 })
  return `${que} ${base} × ${mult}`
}
