import { supabase } from '@/services/supabase/client'
import {
  normalizarVigencia,
  type Atributo,
  type Categoria,
  type ItemPrecio,
  type ListaPrecios,
  type Marca,
  type Vigencia,
} from '../lib/maestros'

/**
 * Configuración → maestros del catálogo (Entrega 3).
 *
 * Todo pasa por RPC `config_*` con el JWT de la persona: listan con conteos de
 * uso y escriben con lista blanca y bitácora. La base ya no acepta escrituras
 * directas en marcas, categorías, atributos, listas ni precios. Para listas,
 * precios y atributos no existe ninguna función de escritura.
 */

export class ErrorMaestro extends Error {
  constructor(readonly codigo: string) {
    super(codigo)
    this.name = 'ErrorMaestro'
  }
}

const CODIGOS = ['sin_permiso', 'nombre_duplicado', 'conflicto_version', 'no_encontrado', 'datos_invalidos', 'campos_no_permitidos', 'en_uso'] as const

function deError(e: { message: string }): ErrorMaestro {
  const base = e.message.split(':')[0] ?? ''
  if ((CODIGOS as readonly string[]).includes(base)) return new ErrorMaestro(e.message)
  if (/permission denied/i.test(e.message)) return new ErrorMaestro('sin_permiso')
  if (/failed to fetch|network/i.test(e.message)) return new ErrorMaestro('sin_red')
  return new ErrorMaestro('desconocido')
}

export interface Listado<T> {
  filas: T[]
  puedeEditar: boolean
}

export async function listarMarcas(companyId: string): Promise<Listado<Marca>> {
  const { data, error } = await supabase.rpc('config_marcas_listar', { p_company: companyId })
  if (error) throw deError(error)
  const filas = data ?? []
  return {
    puedeEditar: filas[0]?.puede_editar ?? false,
    filas: filas.map((m) => ({ id: m.id, nombre: m.name, activa: m.is_active, productos: Number(m.productos), equipos: Number(m.equipos) })),
  }
}

export async function crearMarca(companyId: string, nombre: string): Promise<{ id: string; nombre: string }> {
  const { data, error } = await supabase.rpc('config_marca_crear', { p_company: companyId, p_datos: { name: nombre } })
  if (error) throw deError(error)
  const f = data?.[0]
  if (!f) throw new ErrorMaestro('desconocido')
  return { id: f.id, nombre: f.name }
}

export async function cambiarEstadoMarca(companyId: string, marcaId: string, activa: boolean): Promise<{ cambiado: boolean; productos: number }> {
  const { data, error } = await supabase.rpc('config_marca_estado', { p_company: companyId, p_marca: marcaId, p_activa: activa })
  if (error) throw deError(error)
  const f = data?.[0]
  if (!f) throw new ErrorMaestro('desconocido')
  return { cambiado: f.cambiado, productos: Number(f.productos) }
}

export async function eliminarMarca(companyId: string, marcaId: string): Promise<void> {
  const { error } = await supabase.rpc('config_marca_eliminar', { p_company: companyId, p_marca: marcaId })
  if (error) throw deError(error)
}

export async function listarCategorias(companyId: string): Promise<Listado<Categoria>> {
  const { data, error } = await supabase.rpc('config_categorias_listar', { p_company: companyId })
  if (error) throw deError(error)
  const filas = data ?? []
  return {
    puedeEditar: filas[0]?.puede_editar ?? false,
    filas: filas.map((c) => ({
      id: c.id,
      nombre: c.name,
      slug: c.slug,
      enRevision: c.needs_review,
      activa: c.is_active,
      productos: Number(c.productos),
      atributos: Number(c.atributos),
      subcategorias: Number(c.subcategorias),
    })),
  }
}

export async function crearCategoria(companyId: string, nombre: string): Promise<{ id: string; nombre: string; slug: string }> {
  const { data, error } = await supabase.rpc('config_categoria_crear', { p_company: companyId, p_datos: { name: nombre } })
  if (error) throw deError(error)
  const f = data?.[0]
  if (!f) throw new ErrorMaestro('desconocido')
  return { id: f.id, nombre: f.name, slug: f.slug }
}

/** `esperado` = el nombre que se leyó: si otra persona lo cambió, la base responde conflicto. */
export async function renombrarCategoria(companyId: string, categoriaId: string, esperado: string, nombre: string): Promise<{ nombre: string; cambiado: boolean }> {
  const { data, error } = await supabase.rpc('config_categoria_renombrar', {
    p_company: companyId,
    p_categoria: categoriaId,
    p_esperado: esperado,
    p_datos: { name: nombre },
  })
  if (error) throw deError(error)
  const f = data?.[0]
  if (!f) throw new ErrorMaestro('desconocido')
  return { nombre: f.name, cambiado: f.cambiado }
}

/**
 * Sacar (o devolver) una categoría del catálogo (Fase 25 · E1).
 *
 * Gemela de `cambiarEstadoMarca`, incluido el `cambiado = false` cuando ya
 * estaba en ese estado: lo decide la base, no la pantalla.
 */
export async function cambiarEstadoCategoria(companyId: string, categoriaId: string, activa: boolean): Promise<{ cambiado: boolean; productos: number }> {
  const { data, error } = await supabase.rpc('config_categoria_estado', { p_company: companyId, p_categoria: categoriaId, p_activa: activa })
  if (error) throw deError(error)
  const f = data?.[0]
  if (!f) throw new ErrorMaestro('desconocido')
  return { cambiado: f.cambiado, productos: Number(f.productos) }
}

export async function eliminarCategoria(companyId: string, categoriaId: string): Promise<void> {
  const { error } = await supabase.rpc('config_categoria_eliminar', { p_company: companyId, p_categoria: categoriaId })
  if (error) throw deError(error)
}

export async function listarAtributos(companyId: string): Promise<Atributo[]> {
  const { data, error } = await supabase.rpc('config_atributos_listar', { p_company: companyId })
  if (error) throw deError(error)
  return (data ?? []).map((a) => ({
    clave: a.key,
    etiqueta: a.label,
    tipo: a.data_type,
    unidad: a.unit,
    filtrable: a.is_filterable,
    categorias: a.categorias ?? [],
    productos: Number(a.productos),
  }))
}

export async function listarListasPrecios(companyId: string): Promise<ListaPrecios[]> {
  const { data, error } = await supabase.rpc('config_listas_precios_listar', { p_company: companyId })
  if (error) throw deError(error)
  return (data ?? []).map((l) => ({
    id: l.id,
    nombre: l.name,
    moneda: l.currency_code,
    porDefecto: l.is_default,
    items: Number(l.items),
    itemsVigentes: Number(l.items_vigentes),
    preciosCero: Number(l.precios_cero),
    vigenciaDesde: l.vigencia_desde,
    vigenciaHasta: l.vigencia_hasta,
    clientes: Number(l.clientes),
  }))
}

export async function listarClientesDeLista(companyId: string, listaId: string): Promise<{ filas: { id: string; nombre: string }[]; total: number }> {
  const { data, error } = await supabase.rpc('config_lista_precios_clientes', { p_company: companyId, p_lista: listaId })
  if (error) throw deError(error)
  const filas = data ?? []
  return { total: Number(filas[0]?.total ?? 0), filas: filas.map((c) => ({ id: c.id, nombre: c.legal_name })) }
}

export interface ConsultaItems {
  busqueda: string
  vigencia: 'todas' | Vigencia
  desplazamiento: number
  limite: number
}

export async function listarItemsDeLista(companyId: string, listaId: string, q: ConsultaItems): Promise<{ filas: ItemPrecio[]; total: number }> {
  const { data, error } = await supabase.rpc('config_lista_precios_items', {
    p_company: companyId,
    p_lista: listaId,
    p_busqueda: q.busqueda.trim() || null,
    p_vigencia: q.vigencia,
    p_limite: q.limite,
    p_desplazamiento: q.desplazamiento,
  })
  if (error) throw deError(error)
  const filas = data ?? []
  return {
    total: Number(filas[0]?.total ?? 0),
    filas: filas.map((i) => ({
      id: i.price_id,
      productoId: i.product_id,
      sku: i.sku,
      nombre: i.name,
      marca: i.marca,
      importe: Number(i.amount),
      desde: i.valid_from,
      hasta: i.valid_to,
      vigencia: normalizarVigencia(i.vigencia),
      estadoProducto: i.producto_estado,
    })),
  }
}

/* ── Formas de pago (Fase 68) ──────────────────────────────────────────────
 *
 * Viven acá, con el resto de los maestros, y las usa también el formulario de
 * cotización: es el mismo catálogo y duplicar el servicio sería duplicar el
 * vocabulario de errores.
 *
 * Los documentos guardan el TEXTO de la forma de pago, no el id. Por eso
 * renombrar y hasta borrar una opción es seguro: ninguna cotización queda
 * colgada, y las viejas conservan lo que se acordó. Ver el comentario de la
 * tabla en `docs/database/FASE_68_FORMAS_DE_PAGO.sql`.
 */

/**
 * Dos listas, no una.
 *
 * Comparten vocabulario en parte —«30 días F/F con ECHEQ» está en las dos— pero
 * no sirven para lo mismo: las de proveedores traen medios de pago
 * (TRANSFERENCIA BANCARIA, MERCADOPAGO) e incoterms (FOB 180 DIAS, ExWorks) que
 * no tienen nada que hacer en el desplegable de una cotización.
 */
export type AmbitoFormaDePago = 'sales' | 'purchases'

export interface FormaDePago {
  id: string
  nombre: string
  activa: boolean
  orden: number
  /** En cuántos documentos está escrita hoy. Sirve para no borrar a ciegas. */
  usos: number
}

/** Lo que devuelve la RPC es `jsonb`: se valida fila por fila al mapear. */
function aFormaDePago(x: unknown): FormaDePago | null {
  if (typeof x !== 'object' || x === null) return null
  const o = x as Record<string, unknown>
  if (typeof o['id'] !== 'string' || typeof o['nombre'] !== 'string') return null
  return {
    id: o['id'],
    nombre: o['nombre'],
    activa: o['activa'] !== false,
    orden: Number(o['orden'] ?? 100),
    usos: Number(o['usos'] ?? 0),
  }
}

/** El ambito separa dos listas que no se mezclan: ver `AmbitoFormaDePago`. */
export async function listarFormasDePago(
  companyId: string,
  ambito: AmbitoFormaDePago = 'sales',
): Promise<FormaDePago[]> {
  const { data, error } = await supabase.rpc('config_formas_pago_listar', {
    p_company: companyId,
    p_ambito: ambito,
  })
  if (error) throw deError(error)
  const filas = Array.isArray(data) ? data : []
  return filas.map(aFormaDePago).filter((f): f is FormaDePago => f !== null)
}

export async function crearFormaDePago(
  companyId: string,
  nombre: string,
  ambito: AmbitoFormaDePago = 'sales',
): Promise<FormaDePago> {
  const { data, error } = await supabase.rpc('config_forma_pago_crear', {
    p_company: companyId,
    p_nombre: nombre,
    p_ambito: ambito,
  })
  if (error) throw deError(error)
  const creada = aFormaDePago(data)
  if (!creada) throw new ErrorMaestro('desconocido')
  return creada
}

export async function renombrarFormaDePago(
  companyId: string,
  id: string,
  nombre: string,
): Promise<void> {
  const { error } = await supabase.rpc('config_forma_pago_renombrar', {
    p_company: companyId,
    p_id: id,
    p_nombre: nombre,
  })
  if (error) throw deError(error)
}

export async function cambiarEstadoFormaDePago(
  companyId: string,
  id: string,
  activa: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('config_forma_pago_estado', {
    p_company: companyId,
    p_id: id,
    p_activa: activa,
  })
  if (error) throw deError(error)
}

export async function eliminarFormaDePago(companyId: string, id: string): Promise<void> {
  const { error } = await supabase.rpc('config_forma_pago_eliminar', {
    p_company: companyId,
    p_id: id,
  })
  if (error) throw deError(error)
}
