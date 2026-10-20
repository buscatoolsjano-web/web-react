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
}

export interface ProductoPublicoResumen {
  slug: string
  sku: string
  nombre: string
  marca: string | null
  categoria: string | null
  categoriaSlug: string
  serie: string | null
  tipo: string | null
  /** La foto. `imagenUrl` es la del proveedor; `imagen`, la del bucket. */
  imagen: string | null
  imagenUrl: string | null
  imagenAlt: string | null
}

export interface ProductoPublico extends ProductoPublicoResumen {
  modelo: string | null
  descripcion: string | null
  atributos: Record<string, unknown> | null
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
const numero = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function resumenDe(crudo: unknown): ProductoPublicoResumen {
  const o = (crudo ?? {}) as Record<string, unknown>
  return {
    slug: cadena(o['slug']),
    sku: cadena(o['sku']),
    nombre: cadena(o['nombre']),
    marca: opcional(o['marca']),
    categoria: opcional(o['categoria']),
    categoriaSlug: cadena(o['categoriaSlug']),
    serie: opcional(o['serie']),
    tipo: opcional(o['tipo']),
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
  const { data, error } = await supabase.rpc('catalogo_publico_categorias')
  if (error) throw new FalloCatalogoPublico(`No se pudo leer el catálogo: ${error.message}`)
  if (!Array.isArray(data)) return []
  return data.map((c) => {
    const o = (c ?? {}) as Record<string, unknown>
    return {
      slug: cadena(o['slug']),
      nombre: cadena(o['nombre']),
      productos: numero(o['productos']),
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
  texto?: string | null
  pagina?: number
  porPagina?: number
}

export async function listar(params: Filtros): Promise<PaginaDeCatalogo> {
  const { data, error } = await supabase.rpc('catalogo_publico_listar', {
    p_categoria: params.categoria ?? null,
    p_marca: params.marca ?? null,
    p_serie: params.serie ?? null,
    p_tipo: params.tipo ?? null,
    p_texto: params.texto ?? null,
    p_pagina: params.pagina ?? 1,
    p_por_pagina: params.porPagina ?? 24,
  })
  if (error) throw new FalloCatalogoPublico(`No se pudo leer el catálogo: ${error.message}`)

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
  const atributos = p['atributos']
  const relacionados = Array.isArray(o['relacionados']) ? o['relacionados'] : []

  return {
    producto: {
      ...resumenDe(p),
      modelo: opcional(p['modelo']),
      descripcion: opcional(p['descripcion']),
      atributos:
        typeof atributos === 'object' && atributos !== null && !Array.isArray(atributos)
          ? (atributos as Record<string, unknown>)
          : null,
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

export interface FacetasPublicas {
  total: number
  marcas: OpcionFaceta[]
  series: OpcionFaceta[]
  tipos: OpcionFaceta[]
}

export async function facetas(categoria?: string | null): Promise<FacetasPublicas> {
  const { data, error } = await supabase.rpc('catalogo_publico_facetas', {
    p_categoria: categoria ?? null,
  })
  if (error) throw new FalloCatalogoPublico(`No se pudieron leer los filtros: ${error.message}`)

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

  return {
    total: numero(o['total']),
    marcas: lista(o['marcas']),
    series: lista(o['series']),
    tipos: lista(o['tipos']),
  }
}
