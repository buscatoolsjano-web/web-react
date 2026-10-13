import { supabase } from '@/services/supabase/client'
import type { PvpDeProducto } from '../lib/pvp'

/**
 * El PVP de un puñado de productos, desde la vista `product_pvp` (Fase 51).
 *
 * Es sólo lectura y por ids: la vista tiene una fila por producto con costo
 * cargado —hoy 3.792— y no hay razón para traerla entera para mostrar 25
 * filas. Mismo criterio que la foto en la planilla de precios.
 *
 * `security_invoker` está puesto en la vista, así que la RLS del lector decide:
 * un rol externo no ve costos por este camino.
 */
export async function pvpDeProductos(
  companyId: string,
  ids: readonly string[],
): Promise<Map<string, PvpDeProducto>> {
  const salida = new Map<string, PvpDeProducto>()
  if (ids.length === 0) return salida

  // En lotes, porque `in` viaja en la URL y con cientos de uuid se pasa del
  // largo que acepta el servidor.
  for (let desde = 0; desde < ids.length; desde += 100) {
    const lote = ids.slice(desde, desde + 100)
    const { data, error } = await supabase
      .from('product_pvp')
      .select('product_id, reference, costo, moneda_costo, fecha_costo, multiplier, base_is_cost, pvp')
      .eq('company_id', companyId)
      .in('product_id', lote)

    if (error) throw new Error(`No se pudo calcular el PVP: ${error.message}`)

    for (const f of data ?? []) {
      // La vista ya descarta costo nulo y múltiplo nulo; el guardia de acá es
      // para el tipo, que admite null en toda columna de una vista.
      if (f.product_id === null || f.pvp === null || f.costo === null || f.multiplier === null) continue
      salida.set(f.product_id, {
        productId: f.product_id,
        reference: f.reference ?? '',
        costo: Number(f.costo),
        monedaCosto: f.moneda_costo,
        fechaCosto: f.fecha_costo,
        multiplicador: Number(f.multiplier),
        baseEsCosto: f.base_is_cost ?? true,
        pvp: Number(f.pvp),
      })
    }
  }

  return salida
}

/** El PVP de uno solo, para la ficha. */
export async function pvpDeProducto(
  companyId: string,
  productId: string,
): Promise<PvpDeProducto | null> {
  const mapa = await pvpDeProductos(companyId, [productId])
  return mapa.get(productId) ?? null
}

/**
 * El PVP, pedido para correr EN PARALELO con otra consulta (Fase 61).
 *
 * Es `pvpDeProductos` con dos diferencias, y las dos existen para que se pueda
 * meter en un `Promise.all` sin pensarlo:
 *
 *  1. NO TIRA. Un error devuelve el mapa vacío, que la pantalla interpreta
 *     como «no hay fórmula» y deja los precios de la tarifa —lo que se
 *     mostraba hasta la Fase 51—. Dentro de un `Promise.all`, en cambio, una
 *     excepción acá voltearía también la consulta de los productos, y el
 *     catálogo dejaría de abrir por no haber podido calcular un precio.
 *  2. Con la lista de ids vacía no sale a la red.
 *
 * POR QUÉ IMPORTA EL PARALELO. El PVP sólo necesita los ids, y los ids ya
 * están en cuanto contesta `search_products`: no hay ninguna razón para
 * esperar a que lleguen las filas de los productos. Desde Argentina cada ida
 * y vuelta a São Paulo son ~220 ms fijos, así que encadenarlas de más es la
 * forma más cara de no hacer nada.
 */
export async function pedirPvp(
  companyId: string,
  ids: readonly string[],
): Promise<Map<string, PvpDeProducto>> {
  if (ids.length === 0) return new Map()
  try {
    return await pvpDeProductos(companyId, ids)
  } catch {
    return new Map()
  }
}
