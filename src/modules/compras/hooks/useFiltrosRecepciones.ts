import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FILTROS_RECEPCIONES_INICIALES,
  type DireccionOrden,
  type FiltrosRecepciones,
  type OrdenRecepciones,
} from '../types'

/** Los filtros del listado de recepciones viven en la URL, como los demás. */

const TAMANOS = [10, 25, 50, 100] as const
const ESTADOS = ['draft', 'confirmed']

function aEntero(v: string | null, porDefecto: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : porDefecto
}

function aOrden(v: string | null): OrdenRecepciones {
  return v === 'numero' || v === 'proveedor' || v === 'pedido' || v === 'fecha'
    ? v
    : FILTROS_RECEPCIONES_INICIALES.orden
}

function aDireccion(v: string | null): DireccionOrden {
  return v === 'asc' ? 'asc' : 'desc'
}

/** Una fecha que no tiene forma de fecha se ignora en vez de romper la consulta. */
function aFecha(v: string | null): string {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''
}

export function leerFiltros(params: URLSearchParams): FiltrosRecepciones {
  const porPagina = aEntero(params.get('per'), FILTROS_RECEPCIONES_INICIALES.porPagina)
  const estado = params.get('estado')
  return {
    q: params.get('q') ?? '',
    proveedorId: params.get('prov'),
    pedidoId: params.get('pedido'),
    estado: estado && ESTADOS.includes(estado) ? estado : '',
    depositoId: params.get('dep'),
    desde: aFecha(params.get('desde')),
    hasta: aFecha(params.get('hasta')),
    pagina: aEntero(params.get('page'), 1),
    porPagina: (TAMANOS as readonly number[]).includes(porPagina)
      ? porPagina
      : FILTROS_RECEPCIONES_INICIALES.porPagina,
    orden: aOrden(params.get('orden')),
    direccion: aDireccion(params.get('dir')),
  }
}

export function escribirFiltros(f: FiltrosRecepciones): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q.trim() !== '') p.set('q', f.q.trim())
  if (f.proveedorId) p.set('prov', f.proveedorId)
  if (f.pedidoId) p.set('pedido', f.pedidoId)
  if (f.estado !== '') p.set('estado', f.estado)
  if (f.depositoId) p.set('dep', f.depositoId)
  if (f.desde !== '') p.set('desde', f.desde)
  if (f.hasta !== '') p.set('hasta', f.hasta)
  if (f.pagina > 1) p.set('page', String(f.pagina))
  if (f.porPagina !== FILTROS_RECEPCIONES_INICIALES.porPagina) p.set('per', String(f.porPagina))
  if (f.orden !== FILTROS_RECEPCIONES_INICIALES.orden) p.set('orden', f.orden)
  if (f.direccion !== FILTROS_RECEPCIONES_INICIALES.direccion) p.set('dir', f.direccion)
  return p
}

export const TAMANOS_DE_PAGINA = TAMANOS

export function useFiltrosRecepciones() {
  const [params, setParams] = useSearchParams()
  const filtros = useMemo(() => leerFiltros(params), [params])

  const aplicar = useCallback(
    (cambios: Partial<FiltrosRecepciones>) => {
      const siguiente = { ...leerFiltros(params), ...cambios }
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
    filtros.proveedorId !== null ||
    filtros.pedidoId !== null ||
    filtros.estado !== '' ||
    filtros.depositoId !== null ||
    filtros.desde !== '' ||
    filtros.hasta !== ''

  return { filtros, aplicar, limpiar, hayFiltros }
}
