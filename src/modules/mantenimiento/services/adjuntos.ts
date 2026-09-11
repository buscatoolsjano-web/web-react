import { supabase } from '@/services/supabase/client'

/**
 * Adjuntos de Mantenimiento.
 *
 * **Esto es funcionalidad nueva, no migración.** El Mantenimiento legacy no
 * tiene ni un `<input type="file">` en todo el módulo salvo el de importar un
 * backup JSON: ni fotos de la máquina, ni de la placa, ni del serial, ni PDF.
 * Lo único parecido son los «Manuales», que guardan una URL externa y nada
 * más. Para un servicio técnico esa carencia es grande, y la infraestructura
 * de `attachments` ya estaba: la entrega 1 agregó `maintenance_asset` y
 * `maintenance_order` al CHECK de `entity_type`, y la RLS de esos dos tipos ya
 * resuelve por `app.current_writer_company_ids()` —admin y empleado—, que es
 * exactamente la política v1 de Mantenimiento.
 *
 * O sea: no había que construir nada, había que enchufarlo.
 *
 * El bucket es **privado** y cada descarga usa una URL firmada de cinco
 * minutos. Una URL pública es una URL que se reenvía por WhatsApp y queda
 * accesible para siempre; acá hay fotos de equipos de clientes.
 *
 * El nombre del bucket es «ventas» por historia, no por alcance: guarda los
 * archivos de la empresa. Renombrarlo obligaría a mover objetos ya subidos.
 */

const BUCKET = 'ventas'

/** Los dos tipos de `attachments.entity_type` que son de Mantenimiento. */
export type EntidadMantenimiento = 'maintenance_asset' | 'maintenance_order'

export interface ClaseAdjunto {
  valor: string
  etiqueta: string
}

/**
 * Los valores del CHECK de `attachments.kind` que tienen sentido acá, con el
 * nombre que usa un taller. El CHECK es compartido con Ventas y Compras: lo
 * que cambia es cómo se llama cada cosa en cada pantalla.
 *
 * `photo` va primera porque en un servicio técnico la foto es el adjunto
 * normal —la placa, el serial, la pieza rota—, no la excepción.
 */
export const CLASES_EQUIPO: readonly ClaseAdjunto[] = [
  { valor: 'photo', etiqueta: 'Foto del equipo, la placa o el serial' },
  { valor: 'other', etiqueta: 'Manual o ficha técnica' },
  { valor: 'invoice', etiqueta: 'Factura de compra del equipo' },
  { valor: 'remito', etiqueta: 'Remito' },
  { valor: 'receipt', etiqueta: 'Comprobante' },
]

export const CLASES_ORDEN: readonly ClaseAdjunto[] = [
  { valor: 'photo', etiqueta: 'Foto del estado o de la reparación' },
  { valor: 'other', etiqueta: 'Otro documento' },
  { valor: 'quote_pdf', etiqueta: 'Presupuesto enviado' },
  { valor: 'customer_po', etiqueta: 'Conformidad del cliente' },
  { valor: 'remito', etiqueta: 'Remito de entrega' },
  { valor: 'invoice', etiqueta: 'Factura' },
  { valor: 'receipt', etiqueta: 'Comprobante' },
]

export interface Adjunto {
  id: string
  nombre: string
  bytes: number | null
  clase: string | null
  ruta: string
  subidoEn: string
}

/** 20 MB: el mismo límite que tiene configurado el bucket. */
export const LIMITE_BYTES = 20 * 1024 * 1024

export function formatearBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export async function adjuntosDe(
  companyId: string,
  entidad: EntidadMantenimiento,
  entidadId: string,
): Promise<Adjunto[]> {
  const { data, error } = await supabase
    .from('attachments')
    .select('id, file_name, bytes, kind, storage_path, created_at')
    .eq('company_id', companyId)
    .eq('entity_type', entidad)
    .eq('entity_id', entidadId)
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
 * fallara, quedaría un adjunto apuntando a un archivo que no existe. Y si la
 * fila falla —por ejemplo porque la RLS rechaza la empresa—, se borra el
 * archivo recién subido: un objeto huérfano en el bucket no lo ve nadie pero
 * ocupa lugar y nunca se limpia solo.
 */
export async function subirAdjunto(
  companyId: string,
  entidad: EntidadMantenimiento,
  entidadId: string,
  archivo: File,
  clase = 'photo',
): Promise<void> {
  if (archivo.size > LIMITE_BYTES) {
    throw new Error(
      `El archivo pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB y el máximo es 20 MB.`,
    )
  }

  const ruta = `${companyId}/${entidad}/${entidadId}/${crypto.randomUUID()}-${rutaSegura(archivo.name)}`

  const { error: eSubida } = await supabase.storage.from(BUCKET).upload(ruta, archivo, {
    contentType: archivo.type || 'application/octet-stream',
    upsert: false,
  })
  if (eSubida) throw new Error(`No se pudo subir el archivo: ${eSubida.message}`)

  const { error } = await supabase.from('attachments').insert({
    company_id: companyId,
    entity_type: entidad,
    entity_id: entidadId,
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
