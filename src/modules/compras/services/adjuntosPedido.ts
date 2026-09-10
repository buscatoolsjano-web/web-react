import { supabase } from '@/services/supabase/client'

/**
 * Adjuntos del pedido de compra.
 *
 * Misma tabla `attachments` y mismo bucket privado que Ventas y Proveedores.
 * La entrega 1 agregó `purchase_order` al CHECK de `entity_type` y la
 * entrega 2 partió `attachments_select` por tipo de entidad, así que **la RLS
 * de estos adjuntos es igual de restrictiva que la del proveedor**: sólo
 * admin y employee, ni salesperson ni technician.
 *
 * El nombre del bucket es «ventas» por historia, no por alcance: guarda los
 * archivos de la empresa. Renombrarlo obligaría a mover objetos ya subidos.
 */

const BUCKET = 'ventas'
const ENTIDAD = 'purchase_order'

/** Los valores del CHECK de `attachments.kind` que tienen sentido acá. */
export const CLASES = [
  { valor: 'other', etiqueta: 'Otro' },
  { valor: 'quote_pdf', etiqueta: 'OC enviada / proforma' },
  { valor: 'customer_po', etiqueta: 'Confirmación del proveedor' },
  { valor: 'invoice', etiqueta: 'Factura' },
  { valor: 'receipt', etiqueta: 'Comprobante' },
  { valor: 'photo', etiqueta: 'Foto' },
] as const

export interface AdjuntoPedido {
  id: string
  nombre: string
  bytes: number | null
  clase: string | null
  ruta: string
  subidoEn: string
}

/** 20 MB: el mismo límite que tiene el bucket. */
export const LIMITE_BYTES = 20 * 1024 * 1024

export async function listarAdjuntos(
  companyId: string,
  pedidoId: string,
): Promise<AdjuntoPedido[]> {
  const { data, error } = await supabase
    .from('attachments')
    .select('id, file_name, bytes, kind, storage_path, created_at')
    .eq('company_id', companyId)
    .eq('entity_type', ENTIDAD)
    .eq('entity_id', pedidoId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`No se pudieron leer los adjuntos: ${error.message}`)

  return (data ?? []).map((a) => ({
    id: a.id,
    nombre: a.file_name ?? '(sin nombre)',
    bytes: a.bytes === null ? null : Number(a.bytes),
    clase: a.kind,
    ruta: a.storage_path,
    subidoEn: a.created_at,
  }))
}

/** Nombre seguro para la ruta: sin acentos, espacios ni caracteres raros. */
function rutaSegura(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 100)
}

/**
 * Sube un archivo.
 *
 * Primero el archivo, después la fila. Si la fila se creara antes y la subida
 * fallara, quedaría un adjunto apuntando a un archivo que no existe.
 */
export async function subirAdjunto(
  companyId: string,
  pedidoId: string,
  archivo: File,
  clase = 'other',
): Promise<void> {
  if (archivo.size > LIMITE_BYTES) {
    throw new Error(
      `El archivo pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB y el máximo es 20 MB.`,
    )
  }

  const ruta = `${companyId}/${ENTIDAD}/${pedidoId}/${crypto.randomUUID()}-${rutaSegura(archivo.name)}`

  const { error: eSubida } = await supabase.storage.from(BUCKET).upload(ruta, archivo, {
    contentType: archivo.type || 'application/octet-stream',
    upsert: false,
  })
  if (eSubida) throw new Error(`No se pudo subir el archivo: ${eSubida.message}`)

  const { error } = await supabase.from('attachments').insert({
    company_id: companyId,
    entity_type: ENTIDAD,
    entity_id: pedidoId,
    storage_path: ruta,
    file_name: archivo.name,
    mime_type: archivo.type || null,
    bytes: archivo.size,
    kind: clase,
  })
  if (error) {
    await supabase.storage.from(BUCKET).remove([ruta])
    throw new Error(`No se pudo registrar el adjunto: ${error.message}`)
  }
}

/** URL firmada de cinco minutos. El bucket es privado. */
export async function urlDeDescarga(ruta: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ruta, 300)
  if (error) throw new Error(`No se pudo generar el enlace: ${error.message}`)
  return data.signedUrl
}

export async function borrarAdjunto(id: string, ruta: string): Promise<void> {
  const { error } = await supabase.from('attachments').delete().eq('id', id)
  if (error) throw new Error(`No se pudo borrar el adjunto: ${error.message}`)
  await supabase.storage.from(BUCKET).remove([ruta])
}
