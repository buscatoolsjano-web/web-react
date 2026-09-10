import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FILTROS_PEDIDOS_INICIALES,
  type DireccionOrden,
  type FiltrosPedidos,
  type OrdenPedidos,
} from '../types'

/**
 * Los filtros del listado de pedidos viven en la URL.
 *
 * Un listado filtrado es un link que se comparte, y el botón «atrás» deshace
 * el filtro en vez de salir de la pantalla.
 */

const TAMANOS = [10, 25, 50, 100] as const
const ESTADOS = ['draft', 'confirmed', 'cancelled']
const RECEPCIONES = ['pending', 'partially_received', 'received']

function aEntero(v: string | null, porDefecto: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : porDefecto
}

function aOrden(v: string | null): OrdenPedidos {
  return v === 'numero' || v === 'proveedor' || v === 'total' || v === 'eta' || v === 'fecha'
    ? v
    : FILTROS_PEDIDOS_INICIALES.orden
}

function aDireccion(v: string | null): DireccionOrden {
  return v === 'asc' ? 'asc' : 'desc'
}

/** Una fecha que no tiene forma de fecha se ignora en vez de romper la consulta. */
function aFecha(v: string | null): string {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''
}

function deLista(v: string | null, lista: readonly string[]): string {
  return v && lista.includes(v) ? v : ''
}

export function leerFiltros(params: URLSearchParams): FiltrosPedidos {
  const porPagina = aEntero(params.get('per'), FILTROS_PEDIDOS_INICIALES.porPagina)
  const moneda = (params.get('moneda') ?? '').toUpperCase()
  return {
    q: params.get('q') ?? '',
    proveedorId: params.get('prov'),
    estado: deLista(params.get('estado'), ESTADOS),
    estadoRecepcion: deLista(params.get('recepcion'), RECEPCIONES),
    moneda: /^[A-Z]{3}$/.test(moneda) ? moneda : '',
    desde: aFecha(params.get('desde')),
    hasta: aFecha(params.get('hasta')),
    etaDesde: aFecha(params.get('eta_desde')),
    etaHasta: aFecha(params.get('eta_hasta')),
    sinEta: params.get('sin_eta') === '1',
    pagina: aEntero(params.get('page'), 1),
    porPagina: (TAMANOS as readonly number[]).includes(porPagina)
      ? porPagina
      : FILTROS_PEDIDOS_INICIALES.porPagina,
    orden: aOrden(params.get('orden')),
    direccion: aDireccion(params.get('dir')),
  }
}

export function escribirFiltros(f: FiltrosPedidos): URLSearchParams {
  const p = new URLSearchParams()
  // Sólo lo que difiere del valor por defecto: una URL corta se lee, se
  // comparte y se depura mejor.
  if (f.q.trim() !== '') p.set('q', f.q.trim())
  if (f.proveedorId) p.set('prov', f.proveedorId)
  if (f.estado !== '') p.set('estado', f.estado)
  if (f.estadoRecepcion !== '') p.set('recepcion', f.estadoRecepcion)
  if (f.moneda !== '') p.set('moneda', f.moneda)
  if (f.desde !== '') p.set('desde', f.desde)
  if (f.hasta !== '') p.set('hasta', f.hasta)
  if (f.etaDesde !== '') p.set('eta_desde', f.etaDesde)
  if (f.etaHasta !== '') p.set('eta_hasta', f.etaHasta)
  if (f.sinEta) p.set('sin_eta', '1')
  if (f.pagina > 1) p.set('page', String(f.pagina))
  if (f.porPagina !== FILTROS_PEDIDOS_INICIALES.porPagina) p.set('per', String(f.porPagina))
  if (f.orden !== FILTROS_PEDIDOS_INICIALES.orden) p.set('orden', f.orden)
  if (f.direccion !== FILTROS_PEDIDOS_INICIALES.direccion) p.set('dir', f.direccion)
  return p
}

export const TAMANOS_DE_PAGINA = TAMANOS

export function useFiltrosPedidos() {
  const [params, setParams] = useSearchParams()
  const filtros = useMemo(() => leerFiltros(params), [params])

  const aplicar = useCallback(
    (cambios: Partial<FiltrosPedidos>) => {
      const siguiente = { ...leerFiltros(params), ...cambios }
      // Cualquier cambio que no sea la página propia vuelve a la primera.
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
    filtros.estado !== '' ||
    filtros.estadoRecepcion !== '' ||
    filtros.moneda !== '' ||
    filtros.desde !== '' ||
    filtros.hasta !== '' ||
    filtros.etaDesde !== '' ||
    filtros.etaHasta !== '' ||
    filtros.sinEta

  return { filtros, aplicar, limpiar, hayFiltros }
}
