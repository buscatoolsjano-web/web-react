import { Pagination } from '@/components/tables/Pagination'
import type { Sustantivo } from '@/components/tables/rango'
import { TAMANOS_DE_PAGINA } from '../lib/paginas'

export interface PaginadorProps {
  pagina: number
  porPagina: number
  total: number
  cargando?: boolean
  onIr: (pagina: number) => void
  onTamano: (porPagina: number) => void
  /** Cómo se llaman las filas («orden/órdenes», «equipo/equipos»). */
  sustantivo: Sustantivo
}

/**
 * Paginado real: cada página es un request acotado.
 *
 * Fase 13 · E5: el mismo contrato (página 1-based y tamaño en la URL) sobre la
 * `Pagination` común del sistema, con singular y plural.
 */
export function Paginador({ pagina, porPagina, total, cargando = false, onIr, onTamano, sustantivo }: PaginadorProps) {
  return (
    <Pagination
      offset={(pagina - 1) * porPagina}
      pageSize={porPagina}
      total={total}
      noun={sustantivo}
      loading={cargando}
      onChange={(offset) => onIr(Math.floor(offset / porPagina) + 1)}
      pageSizeOptions={TAMANOS_DE_PAGINA}
      onPageSizeChange={onTamano}
    />
  )
}
