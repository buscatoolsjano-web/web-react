import type { AtributoPresentable, DefinicionAtributo } from '../types'

/** Lo que se muestra cuando un producto no tiene precio en la lista vigente. */
export const SIN_PRECIO = 'Consultar'

/**
 * Formatea un importe.
 *
 * `null` devuelve "Consultar", nunca "$ 0". Un cero se lee como un precio
 * real y es peor que no mostrar nada: en el dataset actual 92 de 219
 * productos no tienen precio, así que este es el camino normal.
 *
 * La moneda viene de price_lists.currency_code — no está hardcodeada.
 */
export function formatearPrecio(monto: number | null, moneda: string | null): string {
  if (monto === null || !Number.isFinite(monto)) return SIN_PRECIO
  if (!moneda) return SIN_PRECIO

  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: moneda,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(monto)
  } catch {
    // Código de moneda desconocido: mejor mostrar el número que romper.
    return `${moneda} ${monto.toFixed(2)}`
  }
}

/** Formatea un entero de stock. 0 es un valor válido y se muestra. */
export function formatearCantidad(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('es-AR').format(n)
}

function valorAString(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v.trim() === '' ? null : v
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  return null
}

/**
 * Cruza el jsonb `attributes` con sus definiciones para poder mostrarlo.
 *
 * NUNCA se muestra el JSON crudo: cada clave se resuelve a su `label` y su
 * `unit` ("torq_max": 250 → "Torque máximo: 250 Nm").
 *
 * Una clave sin definición se DESCARTA. El trigger de la base impide
 * insertarlas, así que si aparece una es un bug que hay que ver, no algo
 * para pintar en pantalla.
 *
 * El orden es el de las definiciones (`position`, después `key`), no el del
 * jsonb: el orden de las claves de un jsonb no es estable.
 */
export function presentarAtributos(
  atributos: Record<string, unknown>,
  definiciones: readonly DefinicionAtributo[],
): AtributoPresentable[] {
  const porClave = new Map(definiciones.map((d) => [d.key, d]))

  const salida: AtributoPresentable[] = []
  for (const [key, bruto] of Object.entries(atributos)) {
    const def = porClave.get(key)
    if (!def) continue

    const valor = valorAString(bruto)
    if (valor === null) continue

    salida.push({ key, label: def.label, valor, unidad: def.unidad })
  }

  return salida.sort((a, b) => {
    const pa = porClave.get(a.key)?.posicion ?? 0
    const pb = porClave.get(b.key)?.posicion ?? 0
    if (pa !== pb) return pa - pb
    return a.key.localeCompare(b.key, 'es')
  })
}

/** "Torque máximo: 250 Nm" — el valor con su unidad, si tiene. */
export function valorConUnidad(a: AtributoPresentable): string {
  return a.unidad ? `${a.valor} ${a.unidad}` : a.valor
}

/** Texto del paginador: "51–100 de 216". */
export function rangoVisible(pagina: number, porPagina: number, total: number): string {
  if (total === 0) return '0 resultados'
  const desde = (pagina - 1) * porPagina + 1
  const hasta = Math.min(pagina * porPagina, total)
  return `${desde}–${hasta} de ${total}`
}

export function totalDePaginas(total: number, porPagina: number): number {
  if (porPagina <= 0) return 1
  return Math.max(1, Math.ceil(total / porPagina))
}
