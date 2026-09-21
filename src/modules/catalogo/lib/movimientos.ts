/**
 * Los tipos de movimiento, en castellano.
 *
 * Es la misma traducción que usa Compras. Un tipo que no esté en la tabla se
 * muestra crudo en vez de desaparecer: si mañana la base agrega uno, se ve el
 * valor real y no un hueco.
 */
const NOMBRES: Record<string, string> = {
  opening_balance: 'Saldo inicial',
  purchase_receipt: 'Recepción de compra',
  sale_delivery: 'Entrega de venta',
  adjustment: 'Ajuste',
  transfer_in: 'Transferencia entrante',
  transfer_out: 'Transferencia saliente',
  maintenance_part: 'Repuesto de mantenimiento',
  return_in: 'Devolución',
}

export function nombreDeMovimiento(tipo: string): string {
  return NOMBRES[tipo] ?? tipo
}

/** `2026-09-08T12:00:00Z` → `08/09/26`. La tabla tiene poco ancho. */
export function formatearFechaCorta(iso: string): string {
  const partes = iso.slice(0, 10).split('-')
  const [a, m, d] = partes
  if (!a || !m || !d) return iso
  return `${d}/${m}/${a.slice(2)}`
}

/**
 * El saldo que dejó cada movimiento, reconstruido hacia atrás.
 *
 * La tabla guarda el movimiento, no el saldo: el saldo de hoy es el punto de
 * partida y cada fila hacia el pasado le resta lo que ese movimiento había
 * sumado. La lista viene de la más nueva a la más vieja.
 *
 * Con `actual` en null —un rol que no ve stock— todas las filas quedan sin
 * saldo. Es la única respuesta honesta: sin el saldo de hoy no hay desde
 * dónde contar.
 */
export function saldosHaciaAtras<T extends { cantidad: number }>(
  movimientos: readonly T[],
  actual: number | null,
): { m: T; resultante: number | null }[] {
  const salida: { m: T; resultante: number | null }[] = []
  let saldo = actual
  for (const m of movimientos) {
    salida.push({ m, resultante: saldo })
    if (saldo !== null) saldo -= m.cantidad
  }
  return salida
}
