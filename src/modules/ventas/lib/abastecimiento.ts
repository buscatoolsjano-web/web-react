import type { CompraDeLinea, LineaAbastecimiento } from '../services/abastecimiento'

/**
 * Las cuentas del abastecimiento de una venta (Fase 237). Puras, para que se
 * prueben sin base.
 *
 * «A veces se compra de más para ya tener: que se entienda bien QUÉ es lo
 * pendiente y QUÉ se compra para stock.» Tres números por línea:
 *   · Pendiente: lo vendido que todavía no tiene compra asignada.
 *   · Sugerido: el pendiente menos el stock disponible (lo que de verdad
 *     falta). Es sólo la propuesta: la cantidad a comprar es libre.
 *   · Reparto de lo que se compra: hasta el pendiente es PARA ESTA VENTA; lo
 *     que pase de ahí es PARA STOCK.
 */

const r = (x: number) => Math.round(x * 1000) / 1000

/** Lo vendido que todavía no tiene una compra asignada. */
export function pendienteDeCompra(
  l: Pick<LineaAbastecimiento, 'vendido' | 'pedidoParaVenta'>,
): number {
  return r(Math.max(0, l.vendido - l.pedidoParaVenta))
}

/** La propuesta de cuánto comprar: lo pendiente que el stock no cubre. */
export function sugeridoComprar(
  l: Pick<LineaAbastecimiento, 'vendido' | 'pedidoParaVenta' | 'stockDisponible'>,
): number {
  return r(Math.max(0, pendienteDeCompra(l) - Math.max(0, l.stockDisponible)))
}

/** Cómo se reparte lo que se compra: para esta venta y para stock. */
export function repartoDeCompra(
  comprar: number,
  l: Pick<LineaAbastecimiento, 'vendido' | 'pedidoParaVenta'>,
): { paraVenta: number; paraStock: number } {
  const c = Math.max(0, comprar)
  const paraVenta = Math.min(c, pendienteDeCompra(l))
  return { paraVenta: r(paraVenta), paraStock: r(c - paraVenta) }
}

/** Lo que ya llegó de las compras de esta venta (la parte de la venta). */
export function recibidoParaVenta(compras: readonly CompraDeLinea[]): number {
  return r(compras.reduce((t, c) => t + Math.min(c.recibido, c.paraVenta), 0))
}

/**
 * Cómo está una línea, en una frase corta: lo que más le importa a quien
 * vende —¿está cubierta?, ¿cuándo llega?—.
 */
export function estadoDeLinea(l: LineaAbastecimiento): {
  tono: 'ok' | 'camino' | 'falta' | 'stock'
  texto: string
} {
  const pendiente = pendienteDeCompra(l)
  const recibido = recibidoParaVenta(l.compras)
  if (l.pedidoParaVenta > 0 && recibido >= l.pedidoParaVenta && pendiente === 0) {
    return { tono: 'ok', texto: 'Recibido' }
  }
  if (pendiente > 0) {
    if (l.stockDisponible >= pendiente) return { tono: 'stock', texto: 'Hay stock' }
    return { tono: 'falta', texto: `Faltan ${formatear(pendiente)}` }
  }
  const proximas = l.compras
    .filter((c) => c.estadoRecepcion !== 'received' && c.paraVenta > 0)
    .map((c) => c.llegadaEstimada)
    .filter((f): f is string => f !== null)
    .sort()
  const ultima = proximas[proximas.length - 1]
  return {
    tono: 'camino',
    texto: ultima ? `En camino · llega ${fechaCorta(ultima)}` : 'En camino · sin fecha',
  }
}

export function formatear(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toLocaleString('es-AR', { maximumFractionDigits: 3 })
}

export function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return a && m && d ? `${d}/${m}/${a}` : iso
}

/**
 * La pantalla de alta del pedido a proveedor, arrancando desde esta venta
 * (Fase 240): ahí se cargan las líneas pendientes vinculadas y se elige el
 * proveedor.
 */
export function rutaCompraDeVenta(tipo: string, id: string, numero: string | null): string {
  const q = new URLSearchParams({ venta: `${tipo}:${id}` })
  if (numero) q.set('numero', numero)
  return `/compras/pedidos/nuevo?${q.toString()}`
}

/** Lo comprado para una venta, resumido para el camino de compras (Fase 240). */
export interface ResumenCompras {
  pedidos: { id: string; numero: string }[]
  paraVenta: number
  recibido: number
  /** La llegada estimada más lejana de lo que todavía no llegó. */
  llegada: string | null
  pendienteSinCompra: number
}

export function resumirCompras(lineas: readonly LineaAbastecimiento[]): ResumenCompras {
  const pedidos = new Map<string, string>()
  let paraVenta = 0
  let recibido = 0
  let pendienteSinCompra = 0
  const llegadas: string[] = []
  for (const l of lineas) {
    pendienteSinCompra += Math.max(0, l.vendido - l.pedidoParaVenta)
    for (const c of l.compras) {
      if (c.paraVenta <= 0) continue
      pedidos.set(c.pedidoId, c.numero)
      paraVenta += c.paraVenta
      recibido += Math.min(c.recibido, c.paraVenta)
      if (c.estadoRecepcion !== 'received' && c.llegadaEstimada) llegadas.push(c.llegadaEstimada)
    }
  }
  llegadas.sort()
  return {
    pedidos: [...pedidos].map(([id, numero]) => ({ id, numero })),
    paraVenta,
    recibido,
    llegada: llegadas[llegadas.length - 1] ?? null,
    pendienteSinCompra,
  }
}
