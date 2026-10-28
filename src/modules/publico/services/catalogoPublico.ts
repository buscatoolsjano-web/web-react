import { supabase } from '@/services/supabase/client'

/**
 * El catálogo público: la única puerta desde el navegador (Fase 87 · E2).
 *
 * Tres funciones y ninguna tabla. Quien entra sin sesión no tiene permiso
 * sobre `products` ni sobre nada: tiene permiso para ejecutar estas tres, que
 * devuelven columnas elegidas a mano del lado del servidor. El detalle de por
 * qué está así vive en `scripts/fase87-catalogo-publico.sql`.
 *
 * ── LO QUE NO LLEGA ACÁ ─────────────────────────────────────────────────────
 *
 * Ni precio, ni costo, ni stock. No hace falta filtrarlo en la pantalla
 * —cosa que alguien podría olvidarse de hacer en una pantalla nueva— porque
 * no viene en la respuesta. Que los tipos de este archivo no tengan un campo
 * `precio` es el recordatorio de que no existe.
 */

export interface CategoriaPublica {
  slug: string
  nombre: string
  productos: number
  /** La foto de portada: la del producto que un admin eligió (Fase 142). */
  portadaUrl?: string | null
  /**
   * El slug con el que buscar la foto del JSON de fotos (Fase 205).
   *
   * Normalmente es el mismo `slug`, pero Torquetools no tiene slug público
   * propio (es `null` y cae al slug singular del ERP, `punta`), y el JSON y las
   * portadas van por el slug público plural (`puntas-y-tubos`). Acá viaja ese
   * slug —resuelto por nombre contra el catálogo público de Buscatools— para
   * que TT muestre las mismas fotos. Si no se setea, se usa `slug`.
   */
  fotoSlug?: string | null
}

export interface ProductoPublicoResumen {
  slug: string
  sku: string
  nombre: string
  marca: string | null
  categoria: string | null
  categoriaSlug: string
  modelo: string | null
  serie: string | null
  tipo: string | null
  /** Los atributos publicables, ya limpios de lo que es del importador. */
  atributos: Record<string, unknown> | null
  /** La foto. `imagenUrl` es la del proveedor; `imagen`, la del bucket. */
  imagen: string | null
  imagenUrl: string | null
  imagenAlt: string | null
}

export interface ProductoPublico extends ProductoPublicoResumen {
  descripcion: string | null
  origen: string | null
  pesoG: number | null
  esKit: boolean
}

export interface PaginaDeCatalogo {
  total: number
  pagina: number
  porPagina: number
  productos: ProductoPublicoResumen[]
}

export class FalloCatalogoPublico extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'FalloCatalogoPublico'
  }
}

const cadena = (v: unknown): string => (typeof v === 'string' ? v : '')
const opcional = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null
/** Un objeto de atributos, o nada. Una lista o un texto no son atributos. */
const objeto = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const numero = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Adopta la respuesta que el head-start de `index.html` ya disparó (Fase 176).
 *
 * El script clásico del `<head>` pide las tres RPC de la portada mientras baja
 * el JS y deja las promesas en `window.__pf`. Acá se consumen UNA vez: si hay
 * una, se devuelve su jsonb ya resuelto; si no la hay, o viene mal, se devuelve
 * `null` y el servicio hace el pedido normal. Nunca rompe: ante cualquier duda,
 * camino de siempre.
 */
async function adelanto(clave: 'categorias' | 'facetas' | 'listar'): Promise<unknown> {
  const w = globalThis as unknown as { __pf?: Record<string, Promise<Response> | null | undefined> }
  const prom = w.__pf?.[clave]
  if (!prom) return null
  w.__pf![clave] = null // una sola vez
  try {
    const r = await prom
    if (!r.ok) return null
    return (await r.json()) as unknown
  } catch {
    return null
  }
}

/** ¿La consulta es la portada, sin ningún filtro puesto? Sólo ahí se adopta. */
const esPortada = (f: Filtros): boolean =>
  !f.categoria && !f.marca && !f.serie && !f.tipo && !f.modelo && !f.texto &&
  !(f.atributos && Object.keys(f.atributos).length > 0)

function resumenDe(crudo: unknown): ProductoPublicoResumen {
  const o = (crudo ?? {}) as Record<string, unknown>
  return {
    slug: cadena(o['slug']),
    sku: cadena(o['sku']),
    nombre: cadena(o['nombre']),
    marca: opcional(o['marca']),
    categoria: opcional(o['categoria']),
    categoriaSlug: cadena(o['categoriaSlug']),
    modelo: opcional(o['modelo']),
    serie: opcional(o['serie']),
    tipo: opcional(o['tipo']),
    atributos: objeto(o['atributos']),
    imagen: opcional(o['imagen']),
    imagenUrl: opcional(o['imagenUrl']),
    imagenAlt: opcional(o['imagenAlt']),
  }
}

/**
 * La dirección de la foto.
 *
 * Hoy los 7.523 productos publicables que tienen foto la tienen en el sitio
 * del proveedor, y ésa se sirve sola. La del bucket propio todavía no la usa
 * ninguno —medido—, pero va a existir en cuanto alguien suba una desde el
 * ERP, y ese bucket es PRIVADO: hasta que se resuelva, se prefiere la que de
 * verdad se puede ver sin sesión.
 */
export function urlDeFoto(p: {
  imagen: string | null
  imagenUrl: string | null
}): string | null {
  return p.imagenUrl ?? null
}

/** Las categorías publicadas, con cuántos productos tiene cada una. */
export async function categorias(): Promise<CategoriaPublica[]> {
  let data = await adelanto('categorias')
  if (data === null) {
    const res = await supabase.rpc('catalogo_publico_categorias')
    if (res.error) throw new FalloCatalogoPublico(`No se pudo leer el catálogo: ${res.error.message}`)
    data = res.data
  }
  if (!Array.isArray(data)) return []
  return data.map((c) => {
    const o = (c ?? {}) as Record<string, unknown>
    return {
      slug: cadena(o['slug']),
      nombre: cadena(o['nombre']),
      productos: numero(o['productos']),
      portadaUrl: opcional(o['portadaUrl']),
    }
  })
}

/**
 * Una página del catálogo.
 *
 * El tope de `porPagina` lo pone el servidor, no esto: un tope que viva sólo
 * acá es un tope que se saltea escribiendo la llamada a mano.
 */
export interface Filtros {
  categoria?: string | null
  marca?: string | null
  serie?: string | null
  tipo?: string | null
  modelo?: string | null
  texto?: string | null
  /** Los atributos elegidos: la clave es la del atributo, no la de la URL. */
  atributos?: Record<string, string> | null
  pagina?: number
  porPagina?: number
}

export async function listar(params: Filtros): Promise<PaginaDeCatalogo> {
  // La portada (sin filtros, página 1, de a 100) la puede haber adelantado el
  // head-start de index.html. Cualquier otra combinación va al pedido normal.
  const portada = esPortada(params) && (params.pagina ?? 1) === 1 && (params.porPagina ?? 24) === 100
  let data = portada ? await adelanto('listar') : null
  if (data === null) {
    const res = await supabase.rpc('catalogo_publico_listar', {
      p_categoria: params.categoria ?? null,
      p_marca: params.marca ?? null,
      p_serie: params.serie ?? null,
      p_tipo: params.tipo ?? null,
      p_texto: params.texto ?? null,
      p_modelo: params.modelo ?? null,
      p_atributos:
        params.atributos && Object.keys(params.atributos).length > 0 ? params.atributos : null,
      p_pagina: params.pagina ?? 1,
      p_por_pagina: params.porPagina ?? 24,
    })
    if (res.error) throw new FalloCatalogoPublico(`No se pudo leer el catálogo: ${res.error.message}`)
    data = res.data
  }

  const o = (data ?? {}) as Record<string, unknown>
  const filas = Array.isArray(o['productos']) ? o['productos'] : []
  return {
    total: numero(o['total']),
    pagina: numero(o['pagina']),
    porPagina: numero(o['porPagina']),
    productos: filas.map(resumenDe),
  }
}

export interface FichaPublica {
  producto: ProductoPublico
  relacionados: ProductoPublicoResumen[]
}

/** Una ficha por su slug. `null` cuando no existe o no es pública. */
export async function producto(slug: string): Promise<FichaPublica | null> {
  const { data, error } = await supabase.rpc('catalogo_publico_producto', { p_slug: slug })
  if (error) throw new FalloCatalogoPublico(`No se pudo leer el producto: ${error.message}`)

  const o = (data ?? {}) as Record<string, unknown>
  if (o['encontrado'] !== true) return null

  const p = (o['producto'] ?? {}) as Record<string, unknown>
  const relacionados = Array.isArray(o['relacionados']) ? o['relacionados'] : []

  return {
    producto: {
      ...resumenDe(p),
      descripcion: opcional(p['descripcion']),
      origen: opcional(p['origen']),
      pesoG: p['pesoG'] === null || p['pesoG'] === undefined ? null : numero(p['pesoG']),
      esKit: p['esKit'] === true,
    },
    relacionados: relacionados.map(resumenDe),
  }
}

/**
 * Las opciones de los filtros, para lo que YA está filtrado (Fase 87 · E2b).
 *
 * Dependen de la categoría elegida y no del catálogo entero: con
 * «Balanceadores» puesto, las marcas que se pueden ofrecer son las tres que
 * tienen balanceadores, no las treinta y tres del catálogo. Un desplegable
 * con opciones que devuelven cero resultados es peor que no tener filtro.
 */
export interface OpcionFaceta {
  /** Para la marca, que va en la URL y no puede llevar espacios. */
  slug?: string
  nombre: string
  cuantos: number
}

/**
 * Un atributo con sus valores, para armar la columna Y su filtro.
 *
 * `cubiertos` es cuántos productos lo tienen cargado: es lo que decide si la
 * columna vale la pena. Una columna vacía en el 95 % de las filas ocupa lugar
 * y no informa.
 */
export interface FacetaAtributoPublica {
  key: string
  label: string
  unidad: string | null
  cubiertos: number
  opciones: { valor: string; cuantos: number }[]
  /**
   * Cómo se filtra (Fase 204). `range` son los numéricos con muchos valores
   * —capacidad en kg, por ejemplo—: no se eligen con tiles sino por rango, así
   * que el filtro guiado por tiles los saltea. Opcional: las facetas del sitio
   * público no lo traen y ahí todo es lista.
   */
  clase?: 'enum' | 'range'
  min?: number | null
  max?: number | null
}

export interface FacetasPublicas {
  total: number
  marcas: OpcionFaceta[]
  categorias: OpcionFaceta[]
  series: OpcionFaceta[]
  tipos: OpcionFaceta[]
  atributos: FacetaAtributoPublica[]
}

export async function facetas(params: Filtros = {}): Promise<FacetasPublicas> {
  let data = esPortada(params) ? await adelanto('facetas') : null
  if (data === null) {
    const res = await supabase.rpc('catalogo_publico_facetas', {
      p_categoria: params.categoria ?? null,
      p_marca: params.marca ?? null,
      p_serie: params.serie ?? null,
      p_tipo: params.tipo ?? null,
      p_atributos:
        params.atributos && Object.keys(params.atributos).length > 0 ? params.atributos : null,
      p_texto: params.texto ?? null,
      p_modelo: params.modelo ?? null,
    })
    if (res.error) throw new FalloCatalogoPublico(`No se pudieron leer los filtros: ${res.error.message}`)
    data = res.data
  }

  const o = (data ?? {}) as Record<string, unknown>
  const lista = (v: unknown): OpcionFaceta[] =>
    (Array.isArray(v) ? v : []).map((x) => {
      const f = (x ?? {}) as Record<string, unknown>
      const slug = opcional(f['slug'])
      return {
        ...(slug !== null ? { slug } : {}),
        nombre: cadena(f['nombre']),
        cuantos: numero(f['cuantos']),
      }
    })

  const atributos = (Array.isArray(o['atributos']) ? o['atributos'] : []).map((x) => {
    const a = (x ?? {}) as Record<string, unknown>
    const opciones = Array.isArray(a['opciones']) ? a['opciones'] : []
    return {
      key: cadena(a['key']),
      label: cadena(a['label']),
      unidad: opcional(a['unidad']),
      cubiertos: numero(a['cubiertos']),
      opciones: opciones.map((y) => {
        const op = (y ?? {}) as Record<string, unknown>
        return { valor: cadena(op['valor']), cuantos: numero(op['cuantos']) }
      }).filter((op) => op.valor !== ''),
    }
  })

  return {
    total: numero(o['total']),
    marcas: lista(o['marcas']),
    categorias: lista(o['categorias']),
    series: lista(o['series']),
    tipos: lista(o['tipos']),
    atributos,
  }
}
