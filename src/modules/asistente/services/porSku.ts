import { supabase } from '@/services/supabase/client'

/**
 * El id de los productos que el asistente nombró, a partir de sus SKU.
 *
 * POR QUÉ NO VIENE EN LA RESPUESTA. El asistente devuelve SKU, nombre, precio
 * y saldo porque es lo que el modelo necesitó para contestar. El uuid no le
 * sirve de nada al modelo: mandarlo sería pagar 36 caracteres por producto en
 * cada vuelta, para un dato que la pantalla puede averiguar sola.
 *
 * Y lo averigua UNA VEZ PARA TODOS: desde acá cada request cuesta ~220 ms
 * fijos, así que resolver producto por producto al apretar cada botón se
 * sentiría lento justo en el momento de actuar.
 *
 * «Ver» no pasa por acá: va a `/catalogo/:sku`, que no necesita el id. Esto es
 * sólo para «Agregar a cotización», que escribe en el carrito y ahí sí hace
 * falta la identidad real.
 */
export interface ProductoResuelto {
  id: string
  sku: string
  nombre: string
}

export async function resolverPorSku(
  companyId: string,
  skus: readonly string[],
): Promise<Map<string, ProductoResuelto>> {
  const unicos = [...new Set(skus)].filter((s) => s !== '')
  if (unicos.length === 0) return new Map()

  const { data, error } = await supabase
    .from('products')
    .select('id, sku, name')
    .eq('company_id', companyId)
    .in('sku', unicos)
  if (error) throw new Error(`No se pudieron resolver los productos: ${error.message}`)

  const salida = new Map<string, ProductoResuelto>()
  for (const p of data ?? []) {
    salida.set(p.sku, { id: p.id, sku: p.sku, nombre: p.name })
  }
  return salida
}
