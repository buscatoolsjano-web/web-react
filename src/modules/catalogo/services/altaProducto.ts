import { supabase } from '@/services/supabase/client'
import type { Json } from '@/types/database.types'
import { hayDatosComerciales, type DatosComerciales, type FilaNuevoProducto } from '../lib/nuevoProducto'

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
  /** `false` cuando el producto se creó pero su receta de kit no se pudo guardar. */
  componentesGuardados: boolean
  /** `false` cuando el producto se creó pero su costo/precio/stock inicial no se pudo guardar. */
  datosComercialesGuardados: boolean
}

/** Una línea de la receta de un kit. */
export interface ComponenteKit {
  productoId: string
  cantidad: number
}

export interface AltaDeProducto {
  fila: FilaNuevoProducto
  /** El archivo elegido. Se sube al bucket `productos`. */
  imagen: File | null
  /** La receta, si es un kit. Vacía si no lo es. */
  componentes: ComponenteKit[]
  /** Costo, precio de venta y stock inicial (Fase 224). Lo vacío no se manda. */
  comercial: DatosComerciales
}

const BUCKET = 'productos'

/** La extensión del tipo REAL que declara el archivo, no la del nombre. */
function extensionDe(tipo: string): string {
  if (tipo === 'image/png') return 'png'
  if (tipo === 'image/webp') return 'webp'
  if (tipo === 'image/avif') return 'avif'
  return 'jpg'
}

/**
 * Inserta el producto y, si corresponde, su receta en una única RPC transaccional;
 * luego sube la imagen como dato accesorio. Si falla la imagen, el producto
 * queda creado y la pantalla lo dice, en vez de perder la carga entera.
 *
 * La ruta del archivo la arma el servidor de esta función y no el usuario:
 * `<company_id>/<product_id>/<uuid>.<ext>`. El nombre que traía el archivo se
 * descarta —puede venir con `../`, con acentos o con 300 caracteres— y la
 * primera carpeta es la que miran las policies del bucket.
 */
export async function crearProducto(
  companyId: string,
  alta: AltaDeProducto,
): Promise<ProductoCreado> {
  const clientRequestId = crypto.randomUUID()
  const audit = await supabase
    .from('product_creation_attempts')
    .insert({
      company_id: companyId,
      client_request_id: clientRequestId,
      sku: alta.fila.sku,
      name: alta.fila.name,
      status: 'started',
    })
    .select('id')
    .maybeSingle()
  const auditId = audit.data?.id ?? null

  const marcarAuditoria = async (cambios: Record<string, unknown>) => {
    if (!auditId) return
    await supabase
      .from('product_creation_attempts')
      .update({ ...cambios, completed_at: new Date().toISOString() })
      .eq('id', auditId)
  }

  const { data: filas, error } = await supabase.rpc('create_product_with_components', {
    p_company: companyId,
    p_product: alta.fila as unknown as Json,
    p_components: alta.componentes as unknown as Json,
  })
  const data = (Array.isArray(filas) ? filas[0] : filas) as
    | { id: string; sku: string; name: string }
    | null

  if (error) {
    const traducido = traducir(error)
    await marcarAuditoria({ status: 'failed', error_code: traducido.codigo, error_message: traducido.message })
    throw traducido
  }
  if (!data) {
    const fallo = new ErrorAltaProducto('desconocido', 'La base no devolvió el producto creado.')
    await marcarAuditoria({ status: 'failed', error_code: fallo.codigo, error_message: fallo.message })
    throw fallo
  }
  await marcarAuditoria({ status: 'succeeded', product_id: data.id })

  // Costo, precio de venta y stock inicial (Fase 224). Van por una RPC
  // `security definer` porque escriben donde el insert no llega —product_prices
  // (sólo lo escribe STEL con service role), las columnas de costo y un
  // movimiento de stock—, y la función valida que el producto sea del ERP (no de
  // STEL) para no pisar su maestro. Igual que la imagen y el kit: si falla, el
  // producto queda creado y la pantalla lo dice, en vez de perder la carga.
  let datosComercialesGuardados = true
  if (hayDatosComerciales(alta.comercial)) {
    const d = alta.comercial
    const { error: errorComercial } = await supabase.rpc('erp_cargar_datos_comerciales', {
      p_company: companyId,
      p_product: data.id,
      ...(d.costAmount !== null && { p_cost_amount: d.costAmount }),
      ...(d.costCurrency !== null && { p_cost_currency: d.costCurrency }),
      ...(d.priceAmount !== null && { p_price_amount: d.priceAmount }),
      ...(d.stockInicial !== null && d.stockInicial !== 0 && { p_stock_inicial: d.stockInicial }),
    })
    if (errorComercial) datosComercialesGuardados = false
  }

  let imagenGuardada = true
  if (alta.imagen !== null) {
    const ruta = `${companyId}/${data.id}/${crypto.randomUUID()}.${extensionDe(alta.imagen.type)}`
    const subida = await supabase.storage.from(BUCKET).upload(ruta, alta.imagen, {
      contentType: alta.imagen.type,
      upsert: false,
    })
    if (subida.error) {
      imagenGuardada = false
    } else {
      const { error: errorImagen } = await supabase.from('product_images').insert({
        company_id: companyId,
        product_id: data.id,
        storage_path: ruta,
        // `product_image` es lo que el listado considera FOTO: un diagrama
        // compartido no cuenta y el producto quedaría con el placeholder.
        kind: 'product_image',
        position: 0,
        is_primary: true,
        bytes: alta.imagen.size,
      })
      if (errorImagen) {
        imagenGuardada = false
        // El byte ya está arriba y la fila no entró: se borra, o queda un
        // archivo huérfano que nadie va a encontrar nunca.
        await supabase.storage.from(BUCKET).remove([ruta])
      }
    }
  }

  return {
    id: data.id,
    sku: data.sku,
    nombre: data.name,
    imagenGuardada,
    // Los componentes entran en la misma transacción que el producto
    // (`create_product_with_components`): si llegamos acá, se guardaron.
    componentesGuardados: true,
    datosComercialesGuardados,
  }
}
