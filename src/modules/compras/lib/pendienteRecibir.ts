import type { Tono } from '@/features/pendientes/util'
import type { ProductoPendienteRecepcion } from '../services/pendienteRecibir'

/** Cómo se lee lo pendiente de recibir de un producto (Fase 238). Puro. */

export type FiltroRecepcion = 'todos' | 'atrasado' | 'ventas' | 'sinFecha'

/** El estado que manda: atrasado primero, después cuándo llega. */
export function estadoDeRecepcion(
  p: Pick<ProductoPendienteRecepcion, 'atrasado' | 'proximaLlegada' | 'recibido'>,
  hoy: string,
): { tono: Tono; texto: string } {
  const parcial = p.recibido > 0 ? 'Parcial · ' : ''
  if (p.atrasado || (p.proximaLlegada !== null && p.proximaLlegada < hoy)) return { tono: 'tAtrasado', texto: `${parcial}Atrasado` }
  if (p.proximaLlegada === null) return { tono: 'tNeutro', texto: `${parcial}Sin fecha` }
  return { tono: 'tCamino', texto: `${parcial}En camino` }
}

export function pasaFiltro(p: ProductoPendienteRecepcion, filtro: FiltroRecepcion, hoy: string): boolean {
  if (filtro === 'todos') return true
  if (filtro === 'ventas') return p.paraVentas > 0
  const e = estadoDeRecepcion(p, hoy)
  if (filtro === 'atrasado') return e.tono === 'tAtrasado'
  return e.tono === 'tNeutro'
}
