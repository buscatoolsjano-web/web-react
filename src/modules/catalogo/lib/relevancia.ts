/**
 * Reconstrucción del orden por relevancia.
 *
 * search_products() devuelve los ids ordenados por score. Después se piden
 * los datos con `.in('id', ids)` — y PostgREST NO garantiza conservar ese
 * orden: devuelve las filas en el orden que le conviene al planificador.
 *
 * Sin esta función, la búsqueda fuzzy mostraría resultados en un orden
 * arbitrario aunque la RPC los haya rankeado bien.
 */

export interface PosicionDeRelevancia {
  id: string
  rank_position: number
}

/**
 * Ordena `filas` según la posición que la RPC le asignó a cada id.
 *
 * Las filas cuyo id no está en el ranking van al final, en su orden
 * original. No debería pasar (los ids salen de la misma búsqueda), pero
 * perder una fila en silencio sería peor que mostrarla último.
 */
export function ordenarPorRelevancia<T extends { id: string }>(
  filas: readonly T[],
  ranking: readonly PosicionDeRelevancia[],
): T[] {
  const posicion = new Map(ranking.map((r) => [r.id, r.rank_position]))
  const AL_FINAL = Number.MAX_SAFE_INTEGER

  return [...filas]
    .map((fila, indiceOriginal) => ({ fila, indiceOriginal }))
    .sort((a, b) => {
      const pa = posicion.get(a.fila.id) ?? AL_FINAL
      const pb = posicion.get(b.fila.id) ?? AL_FINAL
      if (pa !== pb) return pa - pb
      // Empate sólo posible entre filas sin ranking: se respeta el orden
      // en que llegaron, para que el resultado sea determinista.
      return a.indiceOriginal - b.indiceOriginal
    })
    .map((x) => x.fila)
}
