import type { DocumentoDeCliente, TotalPorMoneda } from '../types'

/**
 * Cuánto compró un cliente, **por moneda**.
 *
 * El panel del legacy (`abrirClienteQuickPanel`) hacía
 * `docs.reduce((a, d) => a + d.total, 0)` y mostraba un único importe. En el
 * histórico hay cuatro monedas: 499 documentos en USD, 104 en ARS, 1 en EUR y
 * 32 que no dicen cuál. Ese número era la suma de todo eso, y no significaba
 * nada.
 *
 * Acá cada moneda va por su lado y los que no la tienen forman su propio
 * grupo, rotulado. No se convierte nada: convertir necesitaría un tipo de
 * cambio del día del documento que el legacy casi nunca guardó.
 *
 * Orden: primero por cantidad de documentos, y con la misma cantidad, por
 * código de moneda, para que el resultado sea estable. El grupo «sin moneda»
 * va siempre último — es una ausencia de dato, no una moneda.
 */
export function totalesPorMoneda(
  documentos: readonly DocumentoDeCliente[],
): TotalPorMoneda[] {
  const acumulado = new Map<string, TotalPorMoneda>()

  for (const d of documentos) {
    const clave = d.moneda ?? ''
    const previo = acumulado.get(clave)
    if (previo) {
      previo.documentos += 1
      // Un total nulo cuenta como documento pero no suma importe: el
      // documento existe, lo que falta es el número.
      previo.total += d.total ?? 0
    } else {
      acumulado.set(clave, {
        moneda: d.moneda,
        documentos: 1,
        total: d.total ?? 0,
      })
    }
  }

  return [...acumulado.values()].sort((a, b) => {
    if (a.moneda === null) return 1
    if (b.moneda === null) return -1
    if (a.documentos !== b.documentos) return b.documentos - a.documentos
    return a.moneda.localeCompare(b.moneda)
  })
}
