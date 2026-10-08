import { supabase } from '@/services/supabase/client'
import type { ImagenProducto } from '@/modules/catalogo/types'
import type { CambioDePrecio, Movimiento } from '../lib/comparativa'

/**
 * Las listas de precios de las marcas (Fase 49).
 *
 * Son el REGISTRO de lo que manda cada marca, no los precios de venta: esos
 * los llena STEL y `product_prices` es de sólo lectura para el ERP. Acá no se
 * decide ningún precio; se guarda lo que llegó y se compara con lo anterior.
 *
 * Todo lo de abajo es sólo lectura. La carga la hace un script, porque leer un
 * Excel del Drive y mapear sus columnas es trabajo de una corrida puntual y no
 * de una pantalla.
 */

export interface FuenteDeLista {
  id: string
  nombre: string
  marcaId: string | null
  clase: 'marca' | 'proveedor'
  /** Cuántas listas hay cargadas de esta fuente. */
  versiones: number
  /** La fecha de la más reciente. */
  ultima: string | null
}

export interface VersionDeLista {
  id: string
  fecha: string
  moneda: string
  columnaAncla: string
  origen: string
  archivo: string | null
  enlace: string | null
  nota: string | null
  renglones: number
  /** Cuántos de esos renglones encontraron su producto en el catálogo. */
  cruzan: number
}

/** Las fuentes con su resumen. Pocas filas: una por marca. */
export async function listarFuentes(companyId: string): Promise<FuenteDeLista[]> {
  const { data, error } = await supabase
    .from('price_list_sources')
    .select('id, name, brand_id, kind, price_list_versions ( id, issued_on )')
    .eq('company_id', companyId)
    .order('name')

  if (error) throw new Error(`No se pudieron leer las listas de precios: ${error.message}`)

  type Fila = {
    id: string
    name: string
    brand_id: string | null
    kind: string
    price_list_versions?: { id: string; issued_on: string }[]
  }

  return ((data ?? []) as unknown as Fila[]).map((f) => {
    const vs = f.price_list_versions ?? []
    // El orden de un embebido no lo garantiza PostgREST: se ordena acá.
    const fechas = vs.map((v) => v.issued_on).sort()
    return {
      id: f.id,
      nombre: f.name,
      marcaId: f.brand_id,
      clase: f.kind === 'proveedor' ? 'proveedor' : 'marca',
      versiones: vs.length,
      ultima: fechas.at(-1) ?? null,
    }
  })
}

/**
 * Las versiones de una fuente, de la más nueva a la más vieja.
 *
 * El conteo de renglones viene de la base con `count`, no trayéndose los
 * 3.630 renglones para contarlos acá: una lista entera son ~400 KB y lo único
 * que se quiere mostrar es un número.
 */
export async function listarVersiones(
  companyId: string,
  sourceId: string,
): Promise<VersionDeLista[]> {
  const { data, error } = await supabase
    .from('price_list_versions')
    .select('id, issued_on, currency, anchor_column, origin, file_name, file_url, notes')
    .eq('company_id', companyId)
    .eq('source_id', sourceId)
    .order('issued_on', { ascending: false })

  if (error) throw new Error(`No se pudieron leer las versiones: ${error.message}`)

  const salida: VersionDeLista[] = []
  for (const v of data ?? []) {
    const total = await supabase
      .from('price_list_items')
      .select('id', { count: 'exact', head: true })
      .eq('version_id', v.id)
    const conProducto = await supabase
      .from('price_list_items')
      .select('id', { count: 'exact', head: true })
      .eq('version_id', v.id)
      .not('product_id', 'is', null)

    salida.push({
      id: v.id,
      fecha: v.issued_on,
      moneda: v.currency,
      columnaAncla: v.anchor_column,
      origen: v.origin,
      archivo: v.file_name,
      enlace: v.file_url,
      nota: v.notes,
      renglones: total.count ?? 0,
      cruzan: conProducto.count ?? 0,
    })
  }
  return salida
}

/**
 * Los cambios de una versión contra la anterior de su misma fuente.
 *
 * La cuenta del porcentaje la hace la vista `price_list_changes`, no esta
 * función: así la misma cuenta vale para la pantalla, para un informe y para
 * cualquiera que consulte la base.
 *
 * `limite` existe porque una lista son miles de renglones y la pantalla
 * muestra los que más se movieron. El resumen —cuántos subieron, la mediana—
 * se calcula sobre lo que se trae, así que el límite tiene que ser alto o el
 * resumen miente; por eso el valor por defecto no es 50.
 */
export async function cambiosDeVersion(
  companyId: string,
  versionId: string,
  limite = 5000,
): Promise<CambioDePrecio[]> {
  const { data, error } = await supabase
    .from('price_list_changes')
    .select('reference, description, product_id, precio, precio_anterior, porcentaje, movimiento')
    .eq('company_id', companyId)
    .eq('version_id', versionId)
    .limit(limite)

  if (error) throw new Error(`No se pudo armar la comparativa: ${error.message}`)

  return (data ?? []).map((c) => ({
    reference: c.reference ?? '',
    description: c.description,
    productId: c.product_id,
    precio: c.precio,
    precioAnterior: c.precio_anterior,
    porcentaje: c.porcentaje,
    movimiento: (c.movimiento ?? 'sin dato') as Movimiento,
  }))
}

// ── La planilla adentro (Fase 50) ──────────────────────────────────────────

export interface FilaDePlanilla {
  reference: string
  description: string | null
  productId: string | null
  /**
   * La foto del producto del catálogo, cuando la referencia cruzó.
   *
   * Es el mismo tipo que usa el catálogo, no uno reducido: así la pinta
   * `ImagenProducto`, con su miniatura verificada y su caída a la original
   * cuando la miniatura no existe —que es el 51 % de las de WordPress—.
   */
  imagen: ImagenProducto | null
  sku: string | null
  /** Precio por fecha. Una fecha ausente es una lista donde no estaba. */
  precios: Record<string, number | null>
}

export interface Planilla {
  filas: FilaDePlanilla[]
  total: number
}

/** Limpia las comillas que arrastran algunas descripciones del Excel. */
const sinComillas = (s: string | null) =>
  s === null ? null : s.replace(/^"+|"+$/g, '').replace(/""/g, '"').trim()

/**
 * La planilla de una marca: una fila por referencia, los precios por fecha.
 *
 * Las columnas NO salen de acá: la pantalla las arma con la lista de versiones
 * y busca cada precio por su fecha. El orden de las claves de un jsonb lo
 * normaliza Postgres y confiar en él ya costó una vez (Fase 43).
 *
 * La foto se pide aparte y sólo para las referencias de la página: traerla en
 * el mismo join obligaría a `product_images` en una vista agrupada, y son 25
 * filas contra miles.
 */
export async function planillaDePrecios(
  companyId: string,
  sourceId: string,
  { texto = '', pagina = 1, porPagina = 25 }: { texto?: string; pagina?: number; porPagina?: number } = {},
): Promise<Planilla> {
  const desde = (pagina - 1) * porPagina
  let q = supabase
    .from('price_list_matrix')
    .select('reference, description, product_id, precios', { count: 'exact' })
    .eq('company_id', companyId)
    .eq('source_id', sourceId)

  const buscado = texto.trim()
  if (buscado !== '') {
    // Por referencia o por descripción, que es como se busca un producto.
    //
    // `%` y `_` son comodines de `ilike`: sin escaparlos, buscar «2520/8_» o
    // pegarle a un `%` devuelve cualquier cosa y parece que el buscador anda
    // mal. Se escapan con barra invertida.
    const escapado = buscado.replace(/[%_]/g, (comodin) => '\\' + comodin)
    q = q.or(`reference.ilike.%${escapado}%,description.ilike.%${escapado}%`)
  }

  const { data, error, count } = await q.order('reference').range(desde, desde + porPagina - 1)
  if (error) throw new Error(`No se pudo leer la lista: ${error.message}`)

  const filas = (data ?? []).map((f) => ({
    reference: f.reference ?? '',
    description: sinComillas(f.description),
    productId: f.product_id,
    imagen: null as FilaDePlanilla['imagen'],
    sku: null as string | null,
    precios: (f.precios ?? {}) as Record<string, number | null>,
  }))

  const ids = filas.map((f) => f.productId).filter((x): x is string => x !== null)
  if (ids.length > 0) {
    const { data: prods } = await supabase
      .from('products')
      .select('id, sku, product_images ( source_url, thumb_url, is_primary )')
      .in('id', ids)
      .eq('product_images.is_primary', true)

    type Fila = {
      id: string
      sku: string
      product_images?: { source_url: string | null; thumb_url: string | null }[] | null
    }

    const porId = new Map(((prods ?? []) as unknown as Fila[]).map((p) => [p.id, p]))
    for (const f of filas) {
      const p = f.productId === null ? undefined : porId.get(f.productId)
      if (!p) continue
      f.sku = p.sku
      const img = (p.product_images ?? []).find((i) => i.source_url !== null)
      f.imagen = img
        ? {
            url: img.source_url!,
            thumbUrl: img.thumb_url,
            kind: 'product_image',
            posicion: 0,
            esPrincipal: true,
          }
        : null
    }
  }

  return { filas, total: count ?? 0 }
}
