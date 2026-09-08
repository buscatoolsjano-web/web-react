import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FILTROS_INICIALES, type FiltrosCatalogo, type OrdenCatalogo } from '../types'

/** Claves reservadas del querystring; el resto se interpreta como atributo. */
const RESERVADAS = new Set(['q', 'marca', 'cat', 'serie', 'page', 'per', 'orden'])

function aEntero(v: string | null, porDefecto: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : porDefecto
}

function aOrden(v: string | null): OrdenCatalogo {
  return v === 'sku' || v === 'relevancia' || v === 'nombre' ? v : FILTROS_INICIALES.orden
}

export function leerFiltros(params: URLSearchParams): FiltrosCatalogo {
  const atributos: Record<string, string> = {}
  for (const [k, v] of params.entries()) {
    if (!RESERVADAS.has(k) && v !== '') atributos[k] = v
  }

  return {
    q: params.get('q') ?? '',
    marca: params.get('marca'),
    categoria: params.get('cat'),
    serie: params.get('serie'),
    atributos,
    pagina: aEntero(params.get('page'), FILTROS_INICIALES.pagina),
    porPagina: aEntero(params.get('per'), FILTROS_INICIALES.porPagina),
    orden: aOrden(params.get('orden')),
  }
}

export function escribirFiltros(f: FiltrosCatalogo): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q.trim() !== '') p.set('q', f.q.trim())
  if (f.marca) p.set('marca', f.marca)
  if (f.categoria) p.set('cat', f.categoria)
  if (f.serie) p.set('serie', f.serie)
  for (const [k, v] of Object.entries(f.atributos)) if (v !== '') p.set(k, v)
  if (f.pagina !== FILTROS_INICIALES.pagina) p.set('page', String(f.pagina))
  if (f.porPagina !== FILTROS_INICIALES.porPagina) p.set('per', String(f.porPagina))
  if (f.orden !== FILTROS_INICIALES.orden) p.set('orden', f.orden)
  return p
}

/**
 * Filtros del catálogo, guardados en la URL.
 *
 * Van en el querystring y no en useState para que un filtro se pueda
 * compartir por link, sobreviva a un F5 y funcione con los botones
 * atrás/adelante del navegador. En el legacy vivían en `state.catFilters`,
 * en memoria: recargar la página los perdía todos.
 */
export function useFiltrosCatalogo() {
  const [params, setParams] = useSearchParams()
  const filtros = useMemo(() => leerFiltros(params), [params])

  const actualizar = useCallback(
    (cambios: Partial<FiltrosCatalogo>) => {
      const previos = leerFiltros(params)
      // Cualquier cambio que no sea de página vuelve a la página 1: si no,
      // filtrar estando en la página 5 deja al usuario mirando un vacío.
      const vuelveAPrimera = !('pagina' in cambios)
      setParams(
        escribirFiltros({
          ...previos,
          ...cambios,
          ...(vuelveAPrimera ? { pagina: 1 } : {}),
        }),
      )
    },
    [params, setParams],
  )

  const limpiar = useCallback(() => {
    setParams(new URLSearchParams())
  }, [setParams])

  return { filtros, actualizar, limpiar }
}
