import { supabase } from '@/services/supabase/client'

/**
 * Adjuntos del proveedor.
 *
 * Misma tabla que Ventas (`attachments`) y **mismo bucket privado**: la
 * entrega 1 agregó `supplier` al CHECK de `entity_type` justamente para no
 * crear una segunda tabla, y las policies del bucket ya piden que la primera
 * carpeta de la ruta sea una empresa donde el usuario escribe —que es
 * exactamente el conjunto de Compras—. No hacía falta bucket nuevo ni policy
 * nueva.
 *
 * El nombre del bucket es «ventas» por historia, no por alcance: se creó en
 * Fase 4 y guarda los archivos de la empresa, no los de una sección.
 * Renombrarlo obligaría a mover objetos ya subidos, que es un riesgo sin
 * beneficio.
 *
 * El archivo va a Storage y en la base queda sólo la metadata y la ruta. El
 * legacy guardaba el archivo entero en base64 dentro de `localStorage`.
 */

const BUCKET = 'ventas'
const ENTIDAD = 'supplier'

/** Los valores del CHECK de `attachments.kind` que tienen sentido acá. */
export const CLASES = [
  { valor: 'other', etiqueta: 'Otro' },
  { valor: 'quote_pdf', etiqueta: 'Lista de precios / cotización' },
  { valor: 'invoice', etiqueta: 'Factura' },
  { valor: 'receipt', etiqueta: 'Comprobante' },
  { valor: 'photo', etiqueta: 'Foto' },
] as const

export interface Adjunto {
  id: string
  nombre: string
  tipoMime: string | null
  bytes: number | null
  clase: string | null
  ruta: string
  subidoEn: string
}

/** 20 MB: el mismo límite que tiene el bucket. */
export const LIMITE_BYTES = 20 * 1024 * 1024

export async function listarAdjuntos(companyId: string, proveedorId: string): Promise<Adjunto[]> {
  const { data, error } = await supabase
    .from('attachments')
    .select('id, file_name, mime_type, bytes, kind, storage_path, created_at')
    .eq('company_id', companyId)
    .eq('entity_type', ENTIDAD)
    .eq('entity_id', proveedorId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`No se pudieron leer los adjuntos: ${error.message}`)

  return (data ?? []).map((a) => ({
    id: a.id,
    nombre: a.file_name ?? '(sin nombre)',
    tipoMime: a.mime_type,
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
 * El orden importa: **primero el archivo, después la fila**. Si la fila se
 * creara antes y la subida fallara, quedaría un adjunto que apunta a un
 * archivo que no existe. Al revés, un archivo huérfano no rompe nada; el
 * `catch` lo borra igual.
 */
export async function subirAdjunto(
  companyId: string,
  proveedorId: string,
  archivo: File,
  clase = 'other',
): Promise<void> {
  if (archivo.size > LIMITE_BYTES) {
    throw new Error(
      `El archivo pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB y el máximo es 20 MB.`,
    )
  }

  const ruta = `${companyId}/${ENTIDAD}/${proveedorId}/${crypto.randomUUID()}-${rutaSegura(archivo.name)}`

  const { error: eSubida } = await supabase.storage.from(BUCKET).upload(ruta, archivo, {
    contentType: archivo.type || 'application/octet-stream',
    upsert: false,
  })
  if (eSubida) throw new Error(`No se pudo subir el archivo: ${eSubida.message}`)

  const { error } = await supabase.from('attachments').insert({
    company_id: companyId,
    entity_type: ENTIDAD,
    entity_id: proveedorId,
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

/**
 * URL para descargar, firmada y de vida corta.
 *
 * El bucket es privado: no hay URL pública que se pueda reenviar y quede
 * accesible para siempre. Cinco minutos alcanzan para abrir el archivo y no
 * para compartirlo sin querer.
 */
export async function urlDeDescarga(ruta: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ruta, 300)
  if (error) throw new Error(`No se pudo generar el enlace: ${error.message}`)
  return data.signedUrl
}

export async function borrarAdjunto(id: string, ruta: string): Promise<void> {
  const { error } = await supabase.from('attachments').delete().eq('id', id)
  if (error) throw new Error(`No se pudo borrar el adjunto: ${error.message}`)
  // Si el archivo queda, es basura sin referencia; si la fila queda sin
  // archivo, es un adjunto roto. Por eso primero la fila.
  await supabase.storage.from(BUCKET).remove([ruta])
}

export function formatearBytes(n: number | null): string {
  if (n === null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
