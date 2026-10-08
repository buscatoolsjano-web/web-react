import { supabase } from '@/services/supabase/client'
import { precioVigenteDe } from '@/modules/catalogo/lib/precioVigente'
import { resolverPrecio } from '@/modules/catalogo/lib/pvp'
import { pvpDeProductos } from '@/modules/catalogo/services/pvp'

export interface ProductoParaLinea {
  id: string
  sku: string
  nombre: string
  marca: string | null
  /** Precio en la tarifa del documento (o en la lista por defecto si no hay). */
  precio: number | null
  monedaPrecio: string | null
  /** De qué lista salió el precio, para poder decirlo en pantalla. */
  tarifaId: string | null
  tarifaNombre: string | null
}

export interface OpcionesBusqueda {
  /** La tarifa del documento. `null` o ausente: la lista por defecto de la empresa. */
  listaPrecioId?: string | null
  limite?: number
}

interface FilaPrecio {
  amount: number | string
  price_list_id: string
  valid_from: string | null
  valid_to: string | null
}

/**
 * El precio vigente hoy de una lista.
 *
 * Acá sólo se acota a la lista pedida: **qué fila rige** lo decide
 * `precioVigenteDe`, en el Catálogo, que es la misma función que usa la ficha
 * del producto para mostrar el precio y su fecha.
 *
 * Esta regla vivía duplicada: el catálogo tomaba la primera fila que llegaba y
 * acá se elegía la vigente. Con historia cargada eso significaba que un
 * producto podía mostrar 50 en el catálogo y sugerir 60 en la cotización.
 */
export function precioVigente(filas: readonly FilaPrecio[], listaId: string, hoy: string): number | null {
  const vigente = precioVigenteDe(filas.filter((f) => f.price_list_id === listaId), hoy)
  return vigente ? vigente.monto : null
}

/**
 * Búsqueda de productos para agregar una línea.
 *
 * Va contra la RPC `search_products`, la misma del Catálogo: busca por SKU,
 * nombre y marca del lado del servidor y devuelve como mucho `limite` filas.
 * El legacy tenía los 21.775 productos en un array global y filtraba en
 * memoria; acá el navegador nunca recibe más de lo que se muestra.
 *
 * Fase 15 · E3: el precio se resuelve por **producto + tarifa del documento**.
 * Si la cotización tiene tarifa, se sugiere el precio de ESA lista; si no la
 * tiene, el de la lista por defecto de la empresa. Nunca se cae de una a la
 * otra en silencio: un precio mayorista mostrado como minorista es una
 * cotización mal hecha.
 */
export async function buscarProductos(
  companyId: string,
  texto: string,
  opciones: OpcionesBusqueda = {},
): Promise<ProductoParaLinea[]> {
  const consulta = texto.trim()
  if (consulta.length < 2) return []

  const { data: ranking, error } = await supabase.rpc('search_products', {
    p_company: companyId,
    p_query: consulta,
    p_limit: opciones.limite ?? 20,
    p_offset: 0,
    p_orden: 'nombre',
  })
  if (error) throw new Error(`No se pudieron buscar productos: ${error.message}`)

  const ids = (ranking ?? []).map((r) => r.id)
  if (ids.length === 0) return []

  // La tarifa del documento, o la lista por defecto de la empresa. En los dos
  // casos se exige que sea de ESTA empresa.
  const base = supabase.from('price_lists').select('id, name, currency_code').eq('company_id', companyId)
  const { data: lista } = opciones.listaPrecioId
    ? await base.eq('id', opciones.listaPrecioId).maybeSingle()
    : await base.eq('is_default', true).maybeSingle()

  const { data: filas, error: eP } = await supabase
    .from('products')
    .select('id, sku, name, brands!brand_id ( name ), product_prices ( amount, price_list_id, valid_from, valid_to )')
    .eq('company_id', companyId)
    .in('id', ids)
  if (eP) throw new Error(`No se pudieron leer los productos: ${eP.message}`)

  const porId = new Map(
    ((filas ?? []) as unknown as {
      id: string
      sku: string
      name: string
      brands: { name: string } | null
      product_prices: FilaPrecio[] | null
    }[]).map((p) => [p.id, p]),
  )
  const hoy = new Date().toISOString().slice(0, 10)

  // Se respeta el orden del ranking: la RPC ya ordenó por relevancia.
  const deLaTarifa = ids.flatMap((id) => {
    const p = porId.get(id)
    if (!p) return []
    return [{
      id: p.id,
      sku: p.sku,
      nombre: p.name,
      marca: p.brands?.name ?? null,
      precio: lista ? precioVigente(p.product_prices ?? [], lista.id, hoy) : null,
      monedaPrecio: lista?.currency_code ?? null,
      tarifaId: lista?.id ?? null,
      tarifaNombre: lista?.name ?? null,
    }]
  })

  return conPvp(companyId, deLaTarifa)
}

/**
 * Superpone el PVP de la fórmula sobre el precio de la tarifa (Fase 51).
 *
 * TIENE que estar en los DOS caminos que agregan una línea. El catálogo ya
 * aplica la fórmula —`aplicarPvp` en `modules/catalogo/services/productos`—,
 * así que sin esto el mismo producto entraría con un precio distinto según se
 * agregara desde el modal de «Añadir productos» o desde el buscador del
 * editor. Dos precios para el mismo producto en la misma pantalla es peor que
 * no tener la fórmula.
 *
 * El múltiplo ya viene aplicado desde la vista; acá sólo se elige cuál manda.
 * Si la consulta falla quedan los precios de la tarifa: una cotización se tiene
 * que poder cargar igual.
 */
async function conPvp(
  companyId: string,
  productos: readonly ProductoParaLinea[],
): Promise<ProductoParaLinea[]> {
  if (productos.length === 0) return []
  try {
    const mapa = await pvpDeProductos(companyId, productos.map((p) => p.id))
    if (mapa.size === 0) return [...productos]
    return productos.map((p) => {
      const pvp = mapa.get(p.id)
      if (!pvp) return p
      return { ...p, precio: resolverPrecio(pvp, p.precio).monto }
    })
  } catch {
    return [...productos]
  }
}

export type MotivoPrecio = 'ok' | 'sin_tarifa' | 'sin_precio_en_tarifa' | 'otra_moneda'

/**
 * Por qué hay —o no hay— precio sugerido.
 *
 * `otra_moneda` no se convierte con ningún tipo de cambio ni se reemplaza por
 * otra lista: 104 documentos históricos quedaron sin tipo de cambio porque el
 * legacy inventaba estas cosas.
 */
export function motivoPrecio(p: ProductoParaLinea, monedaDelDocumento: string): MotivoPrecio {
  if (p.tarifaId === null) return 'sin_tarifa'
  if (p.monedaPrecio !== monedaDelDocumento) return 'otra_moneda'
  if (p.precio === null) return 'sin_precio_en_tarifa'
  return 'ok'
}

/** El precio a sugerir para una línea: sólo si la tarifa aplica de verdad. */
export function precioSugerido(p: ProductoParaLinea, monedaDelDocumento: string): number | null {
  return motivoPrecio(p, monedaDelDocumento) === 'ok' ? p.precio : null
}

/** El motivo, en palabras, para mostrar en el buscador. */
export function textoMotivoPrecio(motivo: MotivoPrecio, p: ProductoParaLinea, moneda: string): string | null {
  switch (motivo) {
    case 'ok':
      return null
    case 'sin_tarifa':
      return 'La empresa no tiene lista de precios por defecto.'
    case 'sin_precio_en_tarifa':
      return `Este producto no tiene precio en la tarifa seleccionada${p.tarifaNombre ? ` (${p.tarifaNombre})` : ''}.`
    case 'otra_moneda':
      return `La tarifa ${p.tarifaNombre ?? ''} está en ${p.monedaPrecio ?? 'otra moneda'} y el documento en ${moneda}: no se aplica ni se convierte.`
  }
}

/**
 * Los mismos datos que `buscarProductos`, pero por id (Fase 22 · paridad, #50).
 *
 * Lo usa el carrito del catálogo al abrir una cotización: llegan los ids y las
 * cantidades, y el precio se resuelve **acá**, con la tarifa del documento,
 * igual que cuando se elige un producto a mano en el buscador. El carrito no
 * guarda precios: congelar en el catálogo lo que decide la cotización es la
 * forma segura de que un día no coincidan.
 *
 * Devuelve en el orden de `ids`, que es el orden en que se fueron agregando.
 */
export async function productosPorId(
  companyId: string,
  ids: readonly string[],
  opciones: OpcionesBusqueda = {},
): Promise<ProductoParaLinea[]> {
  if (ids.length === 0) return []

  const base = supabase.from('price_lists').select('id, name, currency_code').eq('company_id', companyId)
  const { data: lista } = opciones.listaPrecioId
    ? await base.eq('id', opciones.listaPrecioId).maybeSingle()
    : await base.eq('is_default', true).maybeSingle()

  const { data: filas, error } = await supabase
    .from('products')
    .select('id, sku, name, brands!brand_id ( name ), product_prices ( amount, price_list_id, valid_from, valid_to )')
    .eq('company_id', companyId)
    .in('id', ids)
  if (error) throw new Error(`No se pudieron leer los productos: ${error.message}`)

  const porId = new Map(
    ((filas ?? []) as unknown as {
      id: string
      sku: string
      name: string
      brands: { name: string } | null
      product_prices: FilaPrecio[] | null
    }[]).map((p) => [p.id, p]),
  )
  const hoy = new Date().toISOString().slice(0, 10)

  const deLaTarifa = ids.flatMap((id) => {
    const p = porId.get(id)
    if (!p) return []
    return [{
      id: p.id,
      sku: p.sku,
      nombre: p.name,
      marca: p.brands?.name ?? null,
      precio: lista ? precioVigente(p.product_prices ?? [], lista.id, hoy) : null,
      monedaPrecio: lista?.currency_code ?? null,
      tarifaId: lista?.id ?? null,
      tarifaNombre: lista?.name ?? null,
    }]
  })

  return conPvp(companyId, deLaTarifa)
}
