import { supabase } from '@/services/supabase/client'
import type { TipoDocumento } from '../types'

const BUCKET = 'ventas'

/**
 * Cómo se llama cada documento dentro de `attachments.entity_type`.
 *
 * Son los valores de su CHECK —`quote`, `order`, `delivery`—, que NO son los
 * mismos que usa `sales_audit` (`sales_quote`, `sales_order`). Es una
 * inconsistencia del schema que viene de Stage 1: se respeta cada tabla como
 * está en vez de migrar datos para que coincidan.
 */
const ENTIDAD: Record<TipoDocumento, string> = {
  cotizacion: 'quote',
  pedido: 'order',
  entrega: 'delivery',
}

/** Los valores que acepta `attachments.kind`. */
export const CLASES = [
  { valor: 'customer_po', etiqueta: 'OC del cliente' },
  { valor: 'quote_pdf', etiqueta: 'Cotización' },
  { valor: 'remito', etiqueta: 'Remito' },
  { valor: 'invoice', etiqueta: 'Factura' },
  { valor: 'receipt', etiqueta: 'Comprobante' },
  { valor: 'photo', etiqueta: 'Foto' },
  { valor: 'other', etiqueta: 'Otro' },
] as const

export interface Adjunto {
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

/** 20 MB: el mismo límite que tiene el bucket, y ahora también un trigger. */
export const LIMITE_BYTES = 20 * 1024 * 1024

/**
 * Los tipos que acepta el bucket (Fase 15 · E6).
 *
 * Es la MISMA lista que `allowed_mime_types` en Storage. Se repite acá para
 * poder decirlo en castellano antes de subir 20 MB y que el servidor conteste
 * `mime type not supported`. El que manda sigue siendo el servidor.
 */
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

/** Lo que dice el servidor → lo que lee una persona. */
const MOTIVOS: Record<string, string> = {
  DOCUMENTO_INEXISTENTE: 'Ese documento no existe en esta empresa.',
  RUTA_INVALIDA: 'La ruta del archivo no corresponde a este documento.',
  ARCHIVO_DEMASIADO_GRANDE: 'El archivo supera los 20 MB.',
  'mime type': 'Ese tipo de archivo no se acepta. Se pueden subir PDF, imágenes, planillas o texto.',
  'exceeded the maximum allowed size': 'El archivo supera los 20 MB.',
  'row-level security': 'Tu rol no puede adjuntar archivos en este documento.',
  Duplicate: 'Ya hay un archivo con esa ruta. Probá de nuevo.',
}

function enCastellano(mensaje: string, porDefecto: string): Error {
  const clave = Object.keys(MOTIVOS).find((c) => mensaje.includes(c))
  return new Error(clave ? MOTIVOS[clave]! : porDefecto)
}

/**
 * Adjuntos de un documento.
 *
 * El legacy los guardaba en `localStorage` —el archivo entero, en base64—,
 * así que tres PDF llenaban la cuota del navegador y se perdían al limpiar
 * los datos del sitio. Acá el archivo va a Storage y en la base queda sólo
 * la metadata y la ruta.
 */
export async function listarAdjuntos(
  companyId: string,
  tipo: TipoDocumento,
  documentoId: string,
): Promise<Adjunto[]> {
  const { data, error } = await supabase
    .from('attachments')
    .select(
      `id, file_name, mime_type, bytes, kind, storage_path, created_at,
       subidor:profiles!uploaded_by ( full_name )`,
    )
    .eq('company_id', companyId)
    .eq('entity_type', ENTIDAD[tipo])
    .eq('entity_id', documentoId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`No se pudieron leer los adjuntos: ${error.message}`)

  const filas = (data ?? []) as unknown as (Omit<Adjunto, 'subidoPor'> & {
    file_name: string | null
    mime_type: string | null
    bytes: number | string | null
    kind: string | null
    storage_path: string
    created_at: string
    subidor: { full_name: string | null } | null
  })[]

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
 * El orden importa: **primero el archivo, después la fila**. Si la fila se
 * creara antes y la subida fallara, quedaría un adjunto que apunta a un
 * archivo que no existe. Al revés, un archivo huérfano no rompe nada y se
 * limpia; el `catch` lo borra igual.
 */
export async function subirAdjunto(
  companyId: string,
  tipo: TipoDocumento,
  documentoId: string,
  archivo: File,
  clase = 'other',
): Promise<void> {
  if (archivo.size === 0) {
    throw new Error('El archivo está vacío.')
  }
  if (archivo.size > LIMITE_BYTES) {
    throw new Error(`El archivo pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB y el máximo es 20 MB.`)
  }
  // El tipo lo declara el navegador y se puede mentir: por eso el bucket lo
  // vuelve a mirar. Acá sólo se evita el viaje inútil.
  if (archivo.type !== '' && !(TIPOS_PERMITIDOS as readonly string[]).includes(archivo.type)) {
    throw new Error('Ese tipo de archivo no se acepta. Se pueden subir PDF, imágenes, planillas o texto.')
  }

  const ruta = `${companyId}/${ENTIDAD[tipo]}/${documentoId}/${crypto.randomUUID()}-${rutaSegura(archivo.name)}`

  const { error: eSubida } = await supabase.storage.from(BUCKET).upload(ruta, archivo, {
    contentType: archivo.type || 'application/octet-stream',
    upsert: false,
  })
  if (eSubida) throw enCastellano(eSubida.message, 'No se pudo subir el archivo.')

  const { error } = await supabase.from('attachments').insert({
    company_id: companyId,
    entity_type: ENTIDAD[tipo],
    entity_id: documentoId,
    storage_path: ruta,
    file_name: archivo.name,
    mime_type: archivo.type || null,
    bytes: archivo.size,
    kind: clase,
  })
  if (error) {
    // La fila no entró (un trigger, RLS o el documento no existe): el archivo
    // que ya subió no puede quedar dando vueltas sin dueño.
    await supabase.storage.from(BUCKET).remove([ruta])
    throw enCastellano(error.message, 'No se pudo registrar el adjunto.')
  }
}

/**
 * URL para descargar, firmada y de vida corta.
 *
 * El bucket es privado: no hay URL pública que se pueda reenviar por mail y
 * quede accesible para siempre. Cinco minutos alcanzan para abrir el archivo
 * y no para compartirlo sin querer.
 */
export async function urlDeDescarga(ruta: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ruta, 300)
  if (error) throw new Error(`No se pudo generar el enlace: ${error.message}`)
  return data.signedUrl
}

/**
 * Borra un adjunto.
 *
 * El orden es a propósito: **primero la fila, después el archivo**. Si se
 * cayera en el medio, lo que queda es un archivo sin referencia —basura que se
 * limpia— y no una fila que promete un archivo que ya no está. La fila es la
 * que se muestra; el archivo, el que se descarga.
 *
 * Si el borrado del archivo falla, la fila ya no está y el adjunto desaparece
 * de la pantalla: se avisa, porque alguien va a tener que limpiar el bucket.
 */
export async function borrarAdjunto(id: string, ruta: string): Promise<void> {
  const { error } = await supabase.from('attachments').delete().eq('id', id)
  if (error) throw enCastellano(error.message, 'No se pudo borrar el adjunto.')

  const { error: eArchivo } = await supabase.storage.from(BUCKET).remove([ruta])
  if (eArchivo) {
    throw new Error(
      'El adjunto se quitó del documento, pero el archivo quedó en el almacenamiento. Avisá a soporte.',
    )
  }
}

export function formatearBytes(n: number | null): string {
  if (n === null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
