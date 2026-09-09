import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FILTROS_INICIALES,
  type DireccionOrden,
  type FiltrosVentas,
  type OrdenVentas,
} from '../types'

/**
 * Los filtros viven en la URL.
 *
 * En el legacy vivían en `state.cotFilters` y se perdían al navegar o al
 * recargar. Acá un listado filtrado es un link que se puede compartir, y el
 * botón «atrás» del navegador deshace el filtro en vez de salir de la página.
 */

const TAMANOS = [10, 25, 50, 100] as const

function aEntero(v: string | null, porDefecto: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : porDefecto
}

function aOrden(v: string | null): OrdenVentas {
  return v === 'numero' || v === 'cliente' || v === 'total' || v === 'fecha'
    ? v
    : FILTROS_INICIALES.orden
}

function aDireccion(v: string | null): DireccionOrden {
  return v === 'asc' ? 'asc' : 'desc'
}

export function leerFiltros(params: URLSearchParams): FiltrosVentas {
  const porPagina = aEntero(params.get('per'), FILTROS_INICIALES.porPagina)
  return {
    q: params.get('q') ?? '',
    clienteId: params.get('cliente'),
    estado: params.get('estado'),
    moneda: params.get('moneda'),
    desde: params.get('desde'),
    hasta: params.get('hasta'),
    soloRevision: params.get('revision') === '1',
    pagina: aEntero(params.get('page'), 1),
    porPagina: (TAMANOS as readonly number[]).includes(porPagina)
      ? porPagina
      : FILTROS_INICIALES.porPagina,
    orden: aOrden(params.get('orden')),
    direccion: aDireccion(params.get('dir')),
  }
}

export function escribirFiltros(f: FiltrosVentas): URLSearchParams {
  const p = new URLSearchParams()
  // Sólo se escribe lo que difiere del valor por defecto: una URL corta se
  // lee, se comparte y se depura mejor.
  if (f.q.trim() !== '') p.set('q', f.q.trim())
  if (f.clienteId) p.set('cliente', f.clienteId)
  if (f.estado) p.set('estado', f.estado)
  if (f.moneda) p.set('moneda', f.moneda)
  if (f.desde) p.set('desde', f.desde)
  if (f.hasta) p.set('hasta', f.hasta)
  if (f.soloRevision) p.set('revision', '1')
  if (f.pagina > 1) p.set('page', String(f.pagina))
  if (f.porPagina !== FILTROS_INICIALES.porPagina) p.set('per', String(f.porPagina))
  if (f.orden !== FILTROS_INICIALES.orden) p.set('orden', f.orden)
  if (f.direccion !== FILTROS_INICIALES.direccion) p.set('dir', f.direccion)
  return p
}

export const TAMANOS_DE_PAGINA = TAMANOS

export function useFiltrosVentas() {
  const [params, setParams] = useSearchParams()
  const filtros = useMemo(() => leerFiltros(params), [params])

  const aplicar = useCallback(
    (cambios: Partial<FiltrosVentas>) => {
      const siguiente = { ...leerFiltros(params), ...cambios }
      // Cualquier cambio que no sea la página propia vuelve a la primera: si
      // no, filtrar estando en la página 9 deja la lista vacía sin explicación.
      if (cambios.pagina === undefined) siguiente.pagina = 1
      setParams(escribirFiltros(siguiente), { replace: true })
    },
    [params, setParams],
  )

  const limpiar = useCallback(() => {
    setParams(new URLSearchParams(), { replace: true })
  }, [setParams])

  const hayFiltros =
    filtros.q.trim() !== '' ||
    filtros.clienteId !== null ||
    filtros.estado !== null ||
    filtros.moneda !== null ||
    filtros.desde !== null ||
    filtros.hasta !== null ||
    filtros.soloRevision

  return { filtros, aplicar, limpiar, hayFiltros }
}
