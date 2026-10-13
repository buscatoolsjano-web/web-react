import { supabase } from '@/services/supabase/client'
import type { ImagenProducto } from '@/modules/catalogo/types'

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
  /** La principal, para la tarjeta. `null` si el producto no tiene ninguna. */
  imagen: ImagenProducto | null
}

/**
 * La foto viene en ESTA consulta, no en una aparte.
 *
 * Es el mismo `select` que ya resolvía el id: agregar la relación embebida no
 * cuesta otra ida y vuelta, y acá cada una son ~220 ms. Una segunda consulta
 * sólo para las imágenes haría que las tarjetas aparezcan y las fotos entren
 * medio segundo después, con el salto de layout que eso implica.
 *
 * Sólo la PRINCIPAL: en una tarjeta se ve una sola, y bajar las demás sería
 * peso puro. Es el mismo criterio que el listado del catálogo.
 */
const COLUMNAS = 'id, sku, name, product_images ( source_url, thumb_url, kind, position, is_primary )'

interface FilaImagen {
  source_url: string | null
  thumb_url: string | null
  kind: string
  position: number
  is_primary: boolean
}

const CLASES = new Set(['product_image', 'shared_diagram', 'technical_diagram', 'unknown'])

function mapearImagen(filas: FilaImagen[] | null): ImagenProducto | null {
  const f = (filas ?? []).find((x) => x.source_url)
  if (!f?.source_url) return null
  return {
    url: f.source_url,
    // `thumb_url` sólo viene poblada si la verificación offline la encontró
    // con HTTP 200; nunca se deriva del nombre del archivo.
    thumbUrl: f.thumb_url,
    kind: (CLASES.has(f.kind) ? f.kind : 'unknown') as ImagenProducto['kind'],
    posicion: f.position,
    esPrincipal: f.is_primary,
  }
}

export async function resolverPorSku(
  companyId: string,
  skus: readonly string[],
): Promise<Map<string, ProductoResuelto>> {
  const unicos = [...new Set(skus)].filter((s) => s !== '')
  if (unicos.length === 0) return new Map()

  const { data, error } = await supabase
    .from('products')
    .select(COLUMNAS)
    .eq('company_id', companyId)
    .in('sku', unicos)
    .eq('product_images.is_primary', true)
  if (error) throw new Error(`No se pudieron resolver los productos: ${error.message}`)

  const salida = new Map<string, ProductoResuelto>()
  for (const p of data ?? []) {
    salida.set(p.sku, {
      id: p.id,
      sku: p.sku,
      nombre: p.name,
      imagen: mapearImagen(p.product_images),
    })
  }
  return salida
}
