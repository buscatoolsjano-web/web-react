import { supabase } from '@/services/supabase/client'
import type { FilaNuevoProducto } from '../lib/nuevoProducto'

/**
 * Crear un producto (Fase 26 · E3).
 *
 * **No hay RPC ni `security definer`:** es un `insert` con el JWT de la persona,
 * y quién puede escribir lo decide la policy `products_write`
 * (`app.current_writer_company_ids()`, o sea admin y employee de la empresa).
 * El legacy hacía lo contrario —llamaba a `erp_create_product`, una función
 * `security definer` que se saltea RLS, con el token público— y por eso
 * cualquiera con la página podía crear productos. Acá el permiso está en la
 * base y no en la pantalla.
 *
 * `company_id` se pone del lado del cliente pero **no es lo que autoriza**: si
 * alguien manda otra empresa, el `with check` de la policy rechaza la fila.
 */
export class ErrorAltaProducto extends Error {
  constructor(
    readonly codigo: 'sku_duplicado' | 'sin_permiso' | 'categoria_invalida' | 'desconocido',
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorAltaProducto'
  }
}

function traducir(e: { code?: string; message: string }): ErrorAltaProducto {
  // 23505 es unique_violation: el único índice único de products por empresa es
  // (company_id, sku).
  if (e.code === '23505' || /products_company_id_sku_key|duplicate key/i.test(e.message)) {
    return new ErrorAltaProducto('sku_duplicado', 'Ya existe un producto con esa referencia.')
  }
  if (/permission denied|row-level security/i.test(e.message)) {
    return new ErrorAltaProducto('sin_permiso', 'Tu rol no puede crear productos.')
  }
  // 23503 es foreign_key_violation: la categoría o la marca no existen.
  if (e.code === '23503') {
    return new ErrorAltaProducto('categoria_invalida', 'La categoría o la marca ya no existen.')
  }
  return new ErrorAltaProducto('desconocido', `No se pudo crear el producto: ${e.message}`)
}

export interface ProductoCreado {
  id: string
  sku: string
  nombre: string
  /** `false` cuando el producto se creó pero su imagen no se pudo registrar. */
  imagenGuardada: boolean
}

/**
 * Inserta el producto y, si se dio una URL, su imagen principal.
 *
 * Son dos escrituras y **no hay transacción**: PostgREST no la ofrece. El orden
 * importa y está elegido: primero el producto —que es lo que se vino a crear— y
 * después la imagen. Si la imagen falla, el producto queda creado y se avisa,
 * en vez de perder la carga entera por una URL.
 */
export async function crearProducto(
  companyId: string,
  fila: FilaNuevoProducto,
  imagenUrl: string | null,
): Promise<ProductoCreado> {
  const { data, error } = await supabase
    .from('products')
    .insert({ ...fila, company_id: companyId })
    .select('id, sku, name')
    .single()

  if (error) throw traducir(error)
  if (!data) throw new ErrorAltaProducto('desconocido', 'La base no devolvió el producto creado.')

  let imagenGuardada = true
  if (imagenUrl !== null && imagenUrl !== '') {
    const { error: errorImagen } = await supabase.from('product_images').insert({
      company_id: companyId,
      product_id: data.id,
      source_url: imagenUrl,
      // `product_image` es lo que el listado considera FOTO: un diagrama
      // compartido no cuenta y el producto quedaría con el placeholder.
      kind: 'product_image',
      position: 0,
      is_primary: true,
    })
    if (errorImagen) imagenGuardada = false
  }

  return { id: data.id, sku: data.sku, nombre: data.name, imagenGuardada }
}
