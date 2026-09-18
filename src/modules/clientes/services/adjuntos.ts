import { supabase } from '@/services/supabase/client'

/**
 * Adjuntos del cliente (Fase 17 · E4).
 *
 * **Misma tabla y mismo bucket que Ventas y Compras**: `attachments` con
 * `entity_type = 'customer'` —que su CHECK ya aceptaba desde Stage 1— y el
 * bucket privado `ventas`. No se creó ninguna tabla ni ningún bucket nuevo.
 *
 * Cada módulo tiene su propio servicio delgado sobre esa infraestructura
 * —Ventas, Compras y Mantenimiento ya lo hacían así— porque lo que cambia es
 * la entidad, el permiso y las clases que tiene sentido ofrecer. Lo que **no**
 * cambia, y por eso está todo del lado del servidor, es la seguridad:
 * `app.validar_adjunto` comprueba que el cliente exista y que la ruta le
 * corresponda, y las policies atan ver el adjunto a ver el cliente y editarlo
 * a administrarlo.
 */

const BUCKET = 'ventas'
const ENTIDAD = 'customer'

/**
 * Las clases que tienen sentido en un cliente.
 *
 * Salen del CHECK de `attachments.kind`, que ya existía: **no se inventó una
 * taxonomía nueva**. De los siete valores se ofrecen cinco; `quote_pdf` y
 * `remito` se dejan afuera porque son adjuntos de un documento concreto y su
 * lugar es ese documento, no la ficha.
 */
export const CLASES = [
  { valor: 'other', etiqueta: 'General' },
  { valor: 'customer_po', etiqueta: 'Orden de compra' },
  { valor: 'invoice', etiqueta: 'Fiscal' },
  { valor: 'receipt', etiqueta: 'Comprobante' },
  { valor: 'photo', etiqueta: 'Foto' },
] as const

export const CLASE_POR_DEFECTO = 'other'

export interface AdjuntoCliente {
  id: string
  nombre: string
  tipoMime: string | null
  bytes: number | null
  clase: string | null
  ruta: string
  subidoEn: string
  /** Quién lo subió. `null` en los que no tienen autor registrado. */
  subidoPor: string | null
}

/** 20 MB: el límite del bucket, y también el del trigger. */
export const LIMITE_BYTES = 20 * 1024 * 1024

/** La misma lista que `allowed_mime_types` del bucket. El que manda es él. */
export const TIPOS_PERMITIDOS = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const

export const TIPOS_ACEPTADOS = TIPOS_PERMITIDOS.join(',')

const MOTIVOS: Record<string, string> = {
  DOCUMENTO_INEXISTENTE: 'Ese cliente no existe en esta empresa.',
  RUTA_INVALIDA: 'La ruta del archivo no corresponde a este cliente.',
  ARCHIVO_DEMASIADO_GRANDE: 'El archivo supera los 20 MB.',
  'mime type': 'Ese tipo de archivo no se acepta. Se pueden subir PDF, imágenes, planillas o texto.',
  'exceeded the maximum allowed size': 'El archivo supera los 20 MB.',
  'row-level security':
    'No podés adjuntar archivos en este cliente. Si está dado de baja, primero reactivalo.',
  Duplicate: 'Ya hay un archivo con esa ruta. Probá de nuevo.',
}

function enCastellano(mensaje: string, porDefecto: string): Error {
  const clave = Object.keys(MOTIVOS).find((c) => mensaje.includes(c))
  return new Error(clave ? MOTIVOS[clave]! : porDefecto)
}

export async function listarAdjuntos(
  companyId: string,
  clienteId: string,
): Promise<AdjuntoCliente[]> {
  const { data, error } = await supabase
    .from('attachments')
    .select(
      `id, file_name, mime_type, bytes, kind, storage_path, created_at,
       subidor:profiles!uploaded_by ( full_name )`,
    )
    .eq('company_id', companyId)
    .eq('entity_type', ENTIDAD)
    .eq('entity_id', clienteId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`No se pudieron leer los adjuntos: ${error.message}`)

  const filas = (data ?? []) as unknown as {
    id: string
    file_name: string | null
    mime_type: string | null
    bytes: number | string | null
    kind: string | null
    storage_path: string
    created_at: string
    subidor: { full_name: string | null } | null
  }[]

  return filas.map((a) => ({
    id: a.id,
    nombre: a.file_name ?? '(sin nombre)',
    tipoMime: a.mime_type,
    bytes: a.bytes === null ? null : Number(a.bytes),
    clase: a.kind,
    ruta: a.storage_path,
    subidoEn: a.created_at,
    subidoPor: a.subidor?.full_name ?? null,
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
 * **Primero el archivo, después la fila.** Si la fila se creara antes y la
 * subida fallara, quedaría un adjunto que apunta a un archivo que no existe.
 * Al revés, un archivo huérfano no rompe nada y el `catch` lo borra.
 */
export async function subirAdjunto(
  companyId: string,
  clienteId: string,
  archivo: File,
  clase: string = CLASE_POR_DEFECTO,
): Promise<void> {
  if (archivo.size === 0) throw new Error('El archivo está vacío.')
  if (archivo.size > LIMITE_BYTES) {
    throw new Error(
      `El archivo pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB y el máximo es 20 MB.`,
    )
  }
  // El tipo lo declara el navegador y se puede mentir: por eso el bucket lo
  // vuelve a mirar. Acá sólo se evita el viaje inútil.
  if (archivo.type !== '' && !(TIPOS_PERMITIDOS as readonly string[]).includes(archivo.type)) {
    throw new Error(
      'Ese tipo de archivo no se acepta. Se pueden subir PDF, imágenes, planillas o texto.',
    )
  }

  const ruta = `${companyId}/${ENTIDAD}/${clienteId}/${crypto.randomUUID()}-${rutaSegura(archivo.name)}`

  const { error: eSubida } = await supabase.storage.from(BUCKET).upload(ruta, archivo, {
    contentType: archivo.type || 'application/octet-stream',
    upsert: false,
  })
  if (eSubida) throw enCastellano(eSubida.message, 'No se pudo subir el archivo.')

  const { error } = await supabase.from('attachments').insert({
    company_id: companyId,
    entity_type: ENTIDAD,
    entity_id: clienteId,
    storage_path: ruta,
    file_name: archivo.name,
    mime_type: archivo.type || null,
    bytes: archivo.size,
    kind: clase,
  })
  if (error) {
    // La fila no entró (el trigger, RLS o el cliente no existe): el archivo que
    // ya subió no puede quedar dando vueltas sin dueño.
    await supabase.storage.from(BUCKET).remove([ruta])
    throw enCastellano(error.message, 'No se pudo registrar el adjunto.')
  }
}

/**
 * URL para descargar, firmada y de vida corta.
 *
 * El bucket es privado: no hay URL pública que se pueda reenviar por mail y
 * quede accesible para siempre. Cinco minutos alcanzan para abrir el archivo y
 * no para compartirlo sin querer.
 */
export async function urlDeDescarga(ruta: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ruta, 300)
  if (error) throw new Error(`No se pudo generar el enlace: ${error.message}`)
  return data.signedUrl
}

/**
 * Borra un adjunto.
 *
 * **Primero la fila, después el archivo.** Si se cayera en el medio, lo que
 * queda es un archivo sin referencia —basura que se limpia— y no una fila que
 * promete un archivo que ya no está.
 */
export async function borrarAdjunto(id: string, ruta: string): Promise<void> {
  const { error } = await supabase.from('attachments').delete().eq('id', id)
  if (error) throw enCastellano(error.message, 'No se pudo borrar el adjunto.')

  const { error: eArchivo } = await supabase.storage.from(BUCKET).remove([ruta])
  if (eArchivo) {
    throw new Error(
      'El adjunto se quitó del cliente, pero el archivo quedó en el almacenamiento. Avisá a soporte.',
    )
  }
}

export function formatearBytes(n: number | null): string {
  if (n === null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
