import { supabase } from '@/services/supabase/client'
import type { ProductoListado } from '../types'

/**
 * Catálogo compartido con distribuidores (2026-11-27) — Fase 2.
 *
 * El distribuidor es una empresa propia y NO lee la tabla de productos del
 * proveedor: todo pasa por `catalogo_compartido_*`, que devuelven sólo campos
 * seguros (nada de costos, otras listas ni stock) y SU precio. Ver la migración
 * 20261127170140.
 */

export interface ItemCompartido {
  id: string
  sku: string
  nombre: string
  modelo: string | null
  marca: { id: string; nombre: string } | null
  categoria: { id: string; nombre: string } | null
  imagen: string | null
  precio: number | null
}

export interface OpcionFiltro {
  id: string
  nombre: string
  cantidad: number
}

export interface PaginaCompartida {
  /** `null` = esta empresa no tiene un catálogo compartido. */
  proveedor: string | null
  moneda: string | null
  total: number
  productos: ItemCompartido[]
  categorias: OpcionFiltro[]
  marcas: OpcionFiltro[]
}

export interface FiltrosCompartido {
  q: string
  categoria: string | null
  marca: string | null
  pagina: number
  porPagina: number
}

export async function listarCompartido(companyId: string, f: FiltrosCompartido): Promise<PaginaCompartida> {
  const { data, error } = await supabase.rpc('catalogo_compartido_listar', {
    p_company: companyId,
    ...(f.q.trim() !== '' && { p_query: f.q.trim() }),
    ...(f.categoria !== null && { p_categoria: f.categoria }),
    ...(f.marca !== null && { p_marca: f.marca }),
    p_pagina: f.pagina,
    p_por_pagina: f.porPagina,
  })
  if (error) throw new Error(`No se pudo leer el catálogo compartido: ${error.message}`)
  const r = (data ?? {}) as Partial<PaginaCompartida>
  return {
    proveedor: r.proveedor ?? null,
    moneda: r.moneda ?? null,
    total: Number(r.total ?? 0),
    productos: r.productos ?? [],
    categorias: r.categorias ?? [],
    marcas: r.marcas ?? [],
  }
}

export interface FichaCompartida {
  id: string
  sku: string
  nombre: string
  modelo: string | null
  descripcion: string | null
  descripcionLarga: string | null
  marca: { id: string; nombre: string } | null
  categoria: { id: string; nombre: string } | null
  imagenes: string[]
  atributos: { etiqueta: string; valor: string; unidad: string | null }[]
  precio: number | null
  moneda: string | null
  proveedor: string
}

export async function fichaCompartida(companyId: string, productId: string): Promise<FichaCompartida | null> {
  const { data, error } = await supabase.rpc('catalogo_compartido_producto', { p_company: companyId, p_product: productId })
  if (error) throw new Error(`No se pudo leer el producto: ${error.message}`)
  return (data as FichaCompartida | null) ?? null
}

/**
 * Un producto compartido con la forma del listado del catálogo, para que el
 * buscador de líneas de la cotización lo use sin saber de dónde vino.
 *
 * Si la moneda del catálogo no es la del documento, el precio no se propone:
 * un USD puesto en una cotización en pesos es peor que un precio vacío.
 */
export function comoProductoListado(p: ItemCompartido, monedaCatalogo: string | null, monedaDocumento: string | null): ProductoListado {
  const precio = monedaDocumento !== null && monedaCatalogo !== null && monedaCatalogo !== monedaDocumento ? null : p.precio
  return {
    enCatalogo: true,
    motivoFueraDelCatalogo: null,
    id: p.id,
    sku: p.sku,
    nombre: p.nombre,
    modelo: p.modelo,
    serie: null,
    tipo: null,
    esKit: false,
    necesitaRevision: false,
    marca: p.marca,
    categoria: p.categoria ? { ...p.categoria, slug: '' } : null,
    atributos: {},
    precio,
    precioOrigen: precio === null ? 'ninguno' : 'tarifa',
    precioTarifa: precio,
    precioDesde: null,
    stock: null,
    disponible: null,
    imagen: p.imagen
      ? { url: p.imagen, thumbUrl: p.imagen, kind: 'product_image', posicion: 0, esPrincipal: true }
      : null,
  }
}

// ── Lo del dueño: compartir el catálogo (sólo administradores generales) ──────

export interface Compartido {
  id: string
  distribuidorId: string
  distribuidorNombre: string | null
  listaPrecioId: string | null
  descuentoPct: number
  marcas: string[] | null
  categorias: string[] | null
  activo: boolean
}

export async function listarCompartidosDe(ownerId: string): Promise<Compartido[]> {
  const { data, error } = await supabase
    .from('catalog_shares')
    .select('id, distributor_company_id, price_list_id, descuento_pct, brand_ids, category_ids, is_active')
    .eq('owner_company_id', ownerId)
    .order('created_at')
  if (error) throw new Error(`No se pudieron leer los catálogos compartidos: ${error.message}`)
  return (data ?? []).map((r) => ({
    id: r.id,
    distribuidorId: r.distributor_company_id,
    distribuidorNombre: null,
    listaPrecioId: r.price_list_id,
    descuentoPct: Number(r.descuento_pct),
    marcas: r.brand_ids,
    categorias: r.category_ids,
    activo: r.is_active,
  }))
}

export interface CambioCompartido {
  ownerId: string
  distribuidorId: string
  descuentoPct: number
  listaPrecioId: string | null
  marcas: string[] | null
  categorias: string[] | null
  activo: boolean
}

const MENSAJES: Record<string, string> = {
  sin_permiso: 'Sólo un administrador general puede compartir el catálogo.',
  empresas_invalidas: 'Elegí un distribuidor distinto de esta empresa.',
  descuento_invalido: 'El descuento tiene que estar entre 0 y 99,99 %.',
  lista_invalida: 'Esa lista de precios no es de esta empresa.',
}

export async function guardarCompartido(c: CambioCompartido): Promise<void> {
  const { error } = await supabase.rpc('config_compartir_catalogo', {
    p_owner: c.ownerId,
    p_distribuidor: c.distribuidorId,
    p_descuento: c.descuentoPct,
    p_price_list: c.listaPrecioId,
    p_marcas: c.marcas,
    p_categorias: c.categorias,
    p_activo: c.activo,
  })
  if (error) {
    const codigo = Object.keys(MENSAJES).find((k) => error.message.includes(k))
    throw new Error(codigo ? MENSAJES[codigo] : 'No se pudo guardar el catálogo compartido.')
  }
}
