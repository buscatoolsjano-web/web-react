/**
 * Disponibilidad y plazo de entrega de una línea (2026-11). PURO.
 *
 * «Plazo y stock»: lo segundo que pregunta un comprador industrial después del
 * precio. Al cotizar, cada línea dice si hay stock, si viene en camino en un
 * pedido a proveedor, o si no hay; y propone un plazo para prometer, que la
 * persona confirma o cambia. El plazo es texto libre y sale en la hoja.
 */

export interface DisponibilidadLinea {
  /** Stock libre (en stock menos reservado), sumando depósitos. */
  libre: number
  /** Lo pedido a proveedores y todavía no recibido del todo. */
  enCamino: number
  /** La llegada estimada más próxima de esos pedidos, si la cargaron. */
  llegada: string | null
}

export type TonoDisponibilidad = 'ok' | 'parcial' | 'camino' | 'sin'

export interface EstadoDisponibilidad {
  tono: TonoDisponibilidad
  texto: string
  /** El plazo que se sugiere prometer, o null si no hay nada de dónde sacarlo. */
  sugerido: string | null
}

/** Plazos de uso habitual, para elegir con un clic. */
export const PLAZOS_HABITUALES = [
  'Inmediato',
  '24/48 hs',
  '7 días',
  '15 días',
  '30 días',
  '30-45 días',
  '60-90 días',
  'A confirmar',
] as const

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a?.slice(2)}`
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('es-AR'))

export function estadoDisponibilidad(cantidad: number, d: DisponibilidadLinea | undefined): EstadoDisponibilidad {
  const libre = d?.libre ?? 0
  const enCamino = d?.enCamino ?? 0
  if (cantidad > 0 && libre >= cantidad) return { tono: 'ok', texto: 'En stock', sugerido: 'Inmediato' }
  if (libre > 0) {
    return {
      tono: 'parcial',
      texto: `Stock: ${num(libre)} de ${num(cantidad)}`,
      sugerido: null,
    }
  }
  if (enCamino > 0) {
    return {
      tono: 'camino',
      texto: d?.llegada ? `En camino · llega ${fechaCorta(d.llegada)}` : 'En camino',
      sugerido: d?.llegada ? `Aprox. ${fechaCorta(d.llegada)}` : null,
    }
  }
  return { tono: 'sin', texto: 'Sin stock', sugerido: null }
}
