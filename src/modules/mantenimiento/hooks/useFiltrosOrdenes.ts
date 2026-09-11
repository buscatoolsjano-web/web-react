import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FILTROS_ORDENES_INICIALES,
  type FiltrosOrdenes,
  type OrdenDeOrdenes,
} from '../types'
import { TAMANOS_DE_PAGINA } from '../lib/paginas'

/** Los filtros del listado de órdenes viven en la URL, igual que los de equipos. */

const ESTADOS = ['open', 'closed', 'cancelled']
const ETAPAS = ['diagnosis', 'quotation', 'repair', 'torque', 'closing']
const ESPERA = ['si', 'no']

function aEntero(v: string | null, porDefecto: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : porDefecto
}

function aOrden(v: string | null): OrdenDeOrdenes {
  return v === 'numero' || v === 'fecha' || v === 'cliente' || v === 'etapa'
    ? v
    : FILTROS_ORDENES_INICIALES.orden
}

function aDireccion(v: string | null): 'asc' | 'desc' {
  return v === 'asc' ? 'asc' : 'desc'
}

/** Una fecha que no tiene forma de fecha se ignora en vez de romper la consulta. */
function aFecha(v: string | null): string {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''
}

function deLista(v: string | null, lista: readonly string[]): string {
  return v && lista.includes(v) ? v : ''
}

export function leerFiltros(params: URLSearchParams): FiltrosOrdenes {
  const porPagina = aEntero(params.get('per'), FILTROS_ORDENES_INICIALES.porPagina)
  return {
    q: params.get('q') ?? '',
    clienteId: params.get('cli'),
    activoId: params.get('eq'),
    estado: deLista(params.get('estado'), ESTADOS),
    etapa: deLista(params.get('etapa'), ETAPAS),
    tecnicoId: params.get('tec'),
    enEspera: deLista(params.get('espera'), ESPERA),
    desde: aFecha(params.get('desde')),
    hasta: aFecha(params.get('hasta')),
    pagina: aEntero(params.get('page'), 1),
    porPagina: (TAMANOS_DE_PAGINA as readonly number[]).includes(porPagina)
      ? porPagina
      : FILTROS_ORDENES_INICIALES.porPagina,
    orden: aOrden(params.get('orden')),
    direccion: aDireccion(params.get('dir')),
  }
}

export function escribirFiltros(f: FiltrosOrdenes): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q.trim() !== '') p.set('q', f.q.trim())
  if (f.clienteId) p.set('cli', f.clienteId)
  if (f.activoId) p.set('eq', f.activoId)
  if (f.estado !== '') p.set('estado', f.estado)
  if (f.etapa !== '') p.set('etapa', f.etapa)
  if (f.tecnicoId) p.set('tec', f.tecnicoId)
  if (f.enEspera !== '') p.set('espera', f.enEspera)
  if (f.desde !== '') p.set('desde', f.desde)
  if (f.hasta !== '') p.set('hasta', f.hasta)
  if (f.pagina > 1) p.set('page', String(f.pagina))
  if (f.porPagina !== FILTROS_ORDENES_INICIALES.porPagina) p.set('per', String(f.porPagina))
  if (f.orden !== FILTROS_ORDENES_INICIALES.orden) p.set('orden', f.orden)
  if (f.direccion !== FILTROS_ORDENES_INICIALES.direccion) p.set('dir', f.direccion)
  return p
}

export function useFiltrosOrdenes() {
  const [params, setParams] = useSearchParams()
  const filtros = useMemo(() => leerFiltros(params), [params])

  const aplicar = useCallback(
    (cambios: Partial<FiltrosOrdenes>) => {
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
    filtros.clienteId !== null ||
    filtros.activoId !== null ||
    filtros.estado !== '' ||
    filtros.etapa !== '' ||
    filtros.tecnicoId !== null ||
    filtros.enEspera !== '' ||
    filtros.desde !== '' ||
    filtros.hasta !== ''

  return { filtros, aplicar, limpiar, hayFiltros }
}
