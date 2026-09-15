import { Pagination } from '@/components/tables/Pagination'
import type { Sustantivo } from '@/components/tables/rango'

interface Props {
  pagina: number
  porPagina: number
  total: number
  onCambiar: (pagina: number) => void
  cargando?: boolean
  /** Cómo se llaman las filas («saldo/saldos», «movimiento/movimientos»). */
  sustantivo: Sustantivo
}

/**
 * «1–50 de 379 movimientos» con Anterior / Siguiente. La página es 0-based.
 *
 * Fase 13 · E5: el mismo contrato sobre la `Pagination` común (singular y
 * plural, «Página X de Y»). Sin selector de tamaño: el servidor fija 50.
 */
export function Paginador({ pagina, porPagina, total, onCambiar, cargando = false, sustantivo }: Props) {
  if (total === 0) return null
  return (
    <Pagination
      offset={pagina * porPagina}
      pageSize={porPagina}
      total={total}
      noun={sustantivo}
      loading={cargando}
      onChange={(offset) => onCambiar(Math.floor(offset / porPagina))}
    />
  )
}
