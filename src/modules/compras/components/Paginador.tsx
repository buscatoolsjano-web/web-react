import { Pagination } from '@/components/tables/Pagination'
import type { Sustantivo } from '@/components/tables/rango'
import { TAMANOS_DE_PAGINA } from '../hooks/useFiltrosProveedores'

export interface PaginadorProps {
  pagina: number
  porPagina: number
  total: number
  cargando?: boolean
  onIr: (pagina: number) => void
  onTamano: (porPagina: number) => void
  /** Cómo se llaman las filas («pedido/pedidos»). */
  sustantivo?: Sustantivo
}

const RESULTADOS: Sustantivo = { singular: 'resultado', plural: 'resultados' }

/**
 * Paginado real: cada página es un request acotado.
 *
 * Fase 13: el mismo contrato de siempre (página 1-based y tamaño en la URL de
 * cada listado) sobre la `Pagination` común del sistema.
 */
export function Paginador({ pagina, porPagina, total, cargando = false, onIr, onTamano, sustantivo = RESULTADOS }: PaginadorProps) {
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
