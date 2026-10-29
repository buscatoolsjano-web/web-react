import { facetas, listar, type Filtros } from '../services/catalogoPublico'

/**
 * El contrato de las consultas del catálogo público, compartido por la página
 * y por el layout (Fase 172).
 *
 * ── POR QUÉ VIVE ACÁ Y NO EN LA PÁGINA ──────────────────────────────────────
 *
 * `CatalogoPublicoPage` es un chunk perezoso: no baja hasta que el visitante
 * ya pidió el HTML, bajó el bundle de entrada y React montó. Recién ahí dispara
 * `listar` y `facetas`. Medido: eso son ~700 ms de más entre que aparece la
 * barra de categorías —que la pide el layout, que sí está en el bundle de
 * entrada— y que aparecen los productos.
 *
 * El layout, que monta antes, adelanta esas dos consultas con estas mismas
 * claves. Cuando el chunk de la página termina de bajar, React Query ya tiene
 * la respuesta (o la tiene en vuelo) y la `useQuery` de la página la reusa sin
 * pedir nada. Para que esa reutilización funcione, las claves y los argumentos
 * tienen que ser idénticos a los dos lados: por eso una sola definición.
 */

/** Los filtros de atributo viajan con prefijo, para no chocar con los demás. */
export const PREFIJO_ATRIBUTO = 'a.'

/**
 * Prefijo de los rangos numéricos: `rango.min_kg.max=10` (Fase 216). Igual que
 * el catálogo del ERP, para que un link pegado de un lado sirva del otro.
 */
export const PREFIJO_RANGO = 'rango.'

/**
 * 100 por página: la primera tanda es grande y se ve casi todo el catálogo de
 * un saque. El tope real lo pone el servidor; esto es lo que pide la portada.
 */
export const POR_PAGINA = 100

export interface FiltrosURL {
  categoria: string | null
  marca: string
  serie: string
  tipo: string
  modelo: string
  texto: string
  /** Lo elegido en las columnas de atributo: `{encastre: '1/4 HEX BIT'}`. */
  atributos: Record<string, string>
  /** Rangos numéricos: `{min_kg: {min: null, max: 10}}` (capacidad, Fase 216). */
  rangos: Record<string, { min: number | null; max: number | null }>
}

/** Lee de la URL los filtros que comparten la página y el layout. */
export function leerFiltros(params: URLSearchParams, categoria: string | undefined): FiltrosURL {
  const atributos: Record<string, string> = {}
  const rangos: Record<string, { min: number | null; max: number | null }> = {}
  for (const [k, v] of params.entries()) {
    if (k.startsWith(PREFIJO_ATRIBUTO) && v !== '') {
      atributos[k.slice(PREFIJO_ATRIBUTO.length)] = v
    } else if (k.startsWith(PREFIJO_RANGO)) {
      // rango.<key>.<min|max>
      const resto = k.slice(PREFIJO_RANGO.length)
      const corte = resto.lastIndexOf('.')
      if (corte <= 0) continue
      const key = resto.slice(0, corte)
      const extremo = resto.slice(corte + 1)
      if (extremo !== 'min' && extremo !== 'max') continue
      const n = Number(v)
      if (v.trim() === '' || !Number.isFinite(n)) continue
      const actual = rangos[key] ?? { min: null, max: null }
      rangos[key] = { ...actual, [extremo]: n }
    }
  }
  return {
    categoria: categoria ?? null,
    marca: params.get('marca') ?? '',
    serie: params.get('serie') ?? '',
    tipo: params.get('tipo') ?? '',
    modelo: params.get('modelo') ?? '',
    texto: params.get('q') ?? '',
    atributos,
    rangos,
  }
}

/** La página elegida, nunca menor que uno. */
export function leerPagina(params: URLSearchParams): number {
  return Math.max(1, Number(params.get('p') ?? '1') || 1)
}

/** ¿Hay algún filtro puesto? Decide el `noindex` y el botón de limpiar. */
export function hayFiltro(f: FiltrosURL): boolean {
  return (
    f.texto !== '' ||
    f.modelo !== '' ||
    f.marca !== '' ||
    f.serie !== '' ||
    f.tipo !== '' ||
    Object.keys(f.atributos).length > 0 ||
    Object.keys(f.rangos).length > 0
  )
}

/** Un `''` es «sin filtro», que para la RPC es `null`. */
const aFiltros = (f: FiltrosURL): Filtros => ({
  categoria: f.categoria,
  marca: f.marca === '' ? null : f.marca,
  serie: f.serie === '' ? null : f.serie,
  tipo: f.tipo === '' ? null : f.tipo,
  modelo: f.modelo === '' ? null : f.modelo,
  texto: f.texto === '' ? null : f.texto,
  atributos: f.atributos,
  rangos: Object.keys(f.rangos).length > 0 ? f.rangos : null,
})

export const claveCategorias = ['catalogo-publico', 'categorias'] as const

export const claveFacetas = (f: FiltrosURL) =>
  [
    'catalogo-publico',
    'facetas',
    f.categoria,
    f.marca,
    f.serie,
    f.tipo,
    f.modelo,
    f.texto,
    f.atributos,
    f.rangos,
  ] as const

export const claveListar = (f: FiltrosURL, pagina: number) =>
  [
    'catalogo-publico',
    'listar',
    f.categoria,
    f.marca,
    f.serie,
    f.tipo,
    f.modelo,
    f.texto,
    f.atributos,
    f.rangos,
    pagina,
  ] as const

export const pedirFacetas = (f: FiltrosURL) => facetas(aFiltros(f))

export const pedirListar = (f: FiltrosURL, pagina: number) =>
  listar({ ...aFiltros(f), pagina, porPagina: POR_PAGINA })
