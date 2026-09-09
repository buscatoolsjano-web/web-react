import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FILTROS_INICIALES,
  type FiltrosCatalogo,
  type OrdenCatalogo,
  type RangoNumerico,
} from '../types'

/** Claves reservadas del querystring; el resto se interpreta como atributo. */
const RESERVADAS = new Set(['q', 'marca', 'cat', 'tipo', 'serie', 'page', 'per', 'orden'])

/**
 * Prefijo de los rangos numéricos: `rango.largo.min=25`.
 *
 * Hace falta un espacio de nombres propio porque hay atributos que se llaman
 * `min_kg` y `max_kg`: un prefijo tipo `min_` chocaría contra ellos.
 */
const PREFIJO_RANGO = 'rango.'

function aEntero(v: string | null, porDefecto: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : porDefecto
}

function aNumero(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function aOrden(v: string | null): OrdenCatalogo {
  return v === 'sku' || v === 'relevancia' || v === 'nombre' ? v : FILTROS_INICIALES.orden
}

export function leerFiltros(params: URLSearchParams): FiltrosCatalogo {
  const atributos: Record<string, string[]> = {}
  const rangos: Record<string, RangoNumerico> = {}

  for (const clave of new Set(params.keys())) {
    if (RESERVADAS.has(clave)) continue

    if (clave.startsWith(PREFIJO_RANGO)) {
      // rango.<key>.<min|max>
      const resto = clave.slice(PREFIJO_RANGO.length)
      const corte = resto.lastIndexOf('.')
      if (corte <= 0) continue
      const key = resto.slice(0, corte)
      const extremo = resto.slice(corte + 1)
      if (extremo !== 'min' && extremo !== 'max') continue
      const valor = aNumero(params.get(clave) ?? undefined)
      if (valor === null) continue
      const actual = rangos[key] ?? { min: null, max: null }
      rangos[key] = { ...actual, [extremo]: valor }
      continue
    }

    // Multi-valor: `?encastre=A&encastre=B`. Un link viejo con un solo valor
    // entra como array de uno, así que los links compartidos siguen sirviendo.
    const valores = params.getAll(clave).filter((v) => v !== '')
    if (valores.length > 0) atributos[clave] = valores
  }

  return {
    q: params.get('q') ?? '',
    marca: params.get('marca'),
    categoria: params.get('cat'),
    subtipos: params.getAll('tipo').filter((v) => v !== ''),
    serie: params.get('serie'),
    atributos,
    rangos,
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
  for (const t of f.subtipos) if (t !== '') p.append('tipo', t)
  if (f.serie) p.set('serie', f.serie)

  for (const [k, valores] of Object.entries(f.atributos)) {
    for (const v of valores) if (v !== '') p.append(k, v)
  }

  for (const [k, r] of Object.entries(f.rangos)) {
    if (r.min !== null) p.set(`${PREFIJO_RANGO}${k}.min`, String(r.min))
    if (r.max !== null) p.set(`${PREFIJO_RANGO}${k}.max`, String(r.max))
  }

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
