import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FILTROS_ACTIVOS_INICIALES,
  type FiltrosActivos,
  type OrdenActivos,
} from '../types'
import { TAMANOS_DE_PAGINA } from '../lib/paginas'

/**
 * Los filtros del listado de equipos viven en la URL.
 *
 * Un listado filtrado es un link que se comparte, y el botón «atrás» deshace
 * el filtro en vez de salir de la pantalla. Es el mismo criterio de Ventas,
 * Clientes y Compras.
 */

const ESTADOS = ['activo', 'baja']

function aEntero(v: string | null, porDefecto: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : porDefecto
}

function aOrden(v: string | null): OrdenActivos {
  return v === 'referencia' || v === 'serie' || v === 'cliente' || v === 'modelo' || v === 'alta'
    ? v
    : FILTROS_ACTIVOS_INICIALES.orden
}

function aDireccion(v: string | null): 'asc' | 'desc' {
  return v === 'asc' ? 'asc' : 'desc'
}

function deLista(v: string | null, lista: readonly string[]): string {
  return v && lista.includes(v) ? v : ''
}

export function leerFiltros(params: URLSearchParams): FiltrosActivos {
  const porPagina = aEntero(params.get('per'), FILTROS_ACTIVOS_INICIALES.porPagina)
  return {
    q: params.get('q') ?? '',
    clienteId: params.get('cli'),
    productoId: params.get('prod'),
    tipo: params.get('tipo') ?? '',
    estado: deLista(params.get('estado'), ESTADOS),
    pagina: aEntero(params.get('page'), 1),
    porPagina: (TAMANOS_DE_PAGINA as readonly number[]).includes(porPagina)
      ? porPagina
      : FILTROS_ACTIVOS_INICIALES.porPagina,
    orden: aOrden(params.get('orden')),
    direccion: aDireccion(params.get('dir')),
  }
}

export function escribirFiltros(f: FiltrosActivos): URLSearchParams {
  const p = new URLSearchParams()
  // Sólo lo que difiere del valor por defecto: una URL corta se lee, se
  // comparte y se depura mejor.
  if (f.q.trim() !== '') p.set('q', f.q.trim())
  if (f.clienteId) p.set('cli', f.clienteId)
  if (f.productoId) p.set('prod', f.productoId)
  if (f.tipo !== '') p.set('tipo', f.tipo)
  if (f.estado !== '') p.set('estado', f.estado)
  if (f.pagina > 1) p.set('page', String(f.pagina))
  if (f.porPagina !== FILTROS_ACTIVOS_INICIALES.porPagina) p.set('per', String(f.porPagina))
  if (f.orden !== FILTROS_ACTIVOS_INICIALES.orden) p.set('orden', f.orden)
  if (f.direccion !== FILTROS_ACTIVOS_INICIALES.direccion) p.set('dir', f.direccion)
  return p
}

export function useFiltrosActivos() {
  const [params, setParams] = useSearchParams()
  const filtros = useMemo(() => leerFiltros(params), [params])

  const aplicar = useCallback(
    (cambios: Partial<FiltrosActivos>) => {
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
    filtros.clienteId !== null ||
    filtros.productoId !== null ||
    filtros.tipo !== '' ||
    filtros.estado !== ''

  return { filtros, aplicar, limpiar, hayFiltros }
}
