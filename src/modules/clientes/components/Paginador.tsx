import { Pagination } from '@/components/tables/Pagination'
import type { Sustantivo } from '@/components/tables/rango'
import { TAMANOS_DE_PAGINA } from '../hooks/useFiltrosClientes'

export interface PaginadorProps {
  pagina: number
  porPagina: number
  total: number
  cargando?: boolean
  onIr: (pagina: number) => void
  onTamano: (porPagina: number) => void
  /** Cómo se llaman las filas («cliente/clientes»). */
  sustantivo?: Sustantivo
}

const RESULTADOS: Sustantivo = { singular: 'resultado', plural: 'resultados' }

/**
 * Paginado real: cada página es un request acotado.
 *
 * El legacy hacía `lista.slice(inicio, fin)` sobre los 988 clientes que ya
 * tenía en memoria. Acá el navegador nunca recibe más de `porPagina`.
 *
 * Fase 13 · E4: el mismo contrato (página 1-based, tamaño en la URL) sobre la
 * `Pagination` común, con singular/plural.
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
