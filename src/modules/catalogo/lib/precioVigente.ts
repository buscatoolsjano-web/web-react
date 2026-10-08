/**
 * Qué precio rige hoy, cuando hay historia (Fase 51).
 *
 * `product_prices` guarda HISTORIA: la unique es lista + producto +
 * `valid_from`, así que el mismo producto en la misma lista puede tener varias
 * filas con distinta vigencia. Tomar «la primera que llega» funciona hasta que
 * hay dos, y entonces la ficha muestra un precio viejo sin avisar.
 *
 * La regla ya existía dentro de Ventas, para el precio que se sugiere al
 * agregar una línea. Vive acá —y Ventas la usa— porque tiene que haber UNA: un
 * producto que muestra 50 en el catálogo y sugiere 60 en la cotización es la
 * clase de diferencia que nadie encuentra hasta que la encuentra un cliente.
 *
 * Devuelve además DESDE CUÁNDO rige, que es la fecha de la última
 * actualización de ese precio. Ese es el dato que faltaba en la ficha.
 */

/** Lo mínimo que hace falta de una fila de `product_prices`. */
export interface FilaDePrecio {
  amount: number | string
  valid_from: string | null
  valid_to: string | null
}

export interface PrecioVigente {
  monto: number
  /** Desde cuándo rige: «la última vez que se actualizó». */
  desde: string | null
  /** Hasta cuándo. `null` es «sigue vigente». */
  hasta: string | null
}

/**
 * La fila que rige en `hoy`, o la más reciente que ya empezó.
 *
 * Una vigencia FUTURA no se devuelve: todavía no rige, y mostrarla diría que
 * el producto ya cuesta eso. Se ordena por `valid_from` descendente y se
 * prefiere la que además no haya terminado; si todas terminaron, la última,
 * porque un precio vencido es el último que hubo y «sin precio» sería falso.
 *
 * Las fechas se comparan como texto a propósito: son `date` de Postgres en
 * ISO (AAAA-MM-DD), donde el orden alfabético y el cronológico coinciden.
 * Construir un `Date` por fila agregaría husos horarios a una comparación que
 * no los necesita.
 */
export function precioVigenteDe(
  filas: readonly FilaDePrecio[],
  hoy: string,
): PrecioVigente | null {
  const empezadas = filas
    .filter((f) => (f.valid_from ?? '') <= hoy)
    .sort((a, b) => (b.valid_from ?? '').localeCompare(a.valid_from ?? ''))

  const elegida = empezadas.find((f) => f.valid_to === null || f.valid_to >= hoy) ?? empezadas[0]
  if (!elegida) return null

  return { monto: Number(elegida.amount), desde: elegida.valid_from, hasta: elegida.valid_to }
}

/** Hoy en ISO, que es la forma en que `product_prices` guarda las fechas. */
export function hoyIso(): string {
  return new Date().toISOString().slice(0, 10)
}
