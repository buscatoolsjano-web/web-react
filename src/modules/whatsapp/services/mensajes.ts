import { supabase } from '@/services/supabase/client'
import { getEnv } from '@/lib/env'
import type { Mensaje } from '../types'

/**
 * El hilo y el envío.
 *
 * El hilo se pagina con cursor sobre `ordenado_en`: una conversación de dos
 * años no se baja entera para mostrar los últimos veinte mensajes. El envío
 * NO va directo a Meta —eso exigiría el token en el navegador—: va a una Edge
 * Function que resuelve destinatario y cuenta del lado del servidor.
 */

const COLUMNAS = `
  id, direction, message_type, text_body, caption, estado_visible, error_details,
  ordenado_en, reply_to_provider_id, provider_message_id,
  media:whatsapp_media!media_id ( id, mime_type, file_name, size_bytes, status, storage_path )
`

interface FilaMensaje {
  id: string
  direction: string
  message_type: string
  text_body: string | null
  caption: string | null
  estado_visible: string | null
  error_details: string | null
  ordenado_en: string
  reply_to_provider_id: string | null
  provider_message_id: string | null
  media: {
    id: string
    mime_type: string
    file_name: string | null
    size_bytes: number | null
    status: string
    storage_path: string | null
  } | null
}

function aMensaje(f: FilaMensaje): Mensaje {
  return {
    id: f.id,
    direccion: f.direction === 'out' ? 'out' : 'in',
    tipo: f.message_type,
    texto: f.text_body,
    caption: f.caption,
    estadoVisible: f.estado_visible,
    errorDetalle: f.error_details,
    ordenadoEn: f.ordenado_en,
    respondeA: f.reply_to_provider_id,
    proveedorId: f.provider_message_id,
    adjunto: f.media
      ? {
          id: f.media.id,
          mime: f.media.mime_type,
          nombre: f.media.file_name,
          bytes: f.media.size_bytes,
          estado: f.media.status as Mensaje['adjunto'] extends null ? never : 'pendiente',
          rutaStorage: f.media.storage_path,
        }
      : null,
  }
}

export interface PaginaMensajes {
  mensajes: Mensaje[]
  /** `ordenado_en` del más viejo devuelto: se pasa como cursor para pedir más. */
  cursor: string | null
  hayMas: boolean
}

/**
 * Una página del hilo, del más nuevo al más viejo.
 *
 * Se devuelve en orden cronológico para dibujar, pero se PIDE al revés: la
 * página que importa es la última, no la primera.
 */
export async function listarMensajes(
  conversacionId: string,
  anteriorA: string | null = null,
  limite = 40,
): Promise<PaginaMensajes> {
  let q = supabase
    .from('whatsapp_messages')
    .select(COLUMNAS)
    .eq('conversation_id', conversacionId)
    .order('ordenado_en', { ascending: false })
    .order('id', { ascending: false })
    .limit(limite + 1)

  if (anteriorA) q = q.lt('ordenado_en', anteriorA)

  const { data, error } = await q
  if (error) throw new Error(`No se pudieron leer los mensajes: ${error.message}`)

  const filas = (data ?? []) as unknown as FilaMensaje[]
  const hayMas = filas.length > limite
  const pagina = hayMas ? filas.slice(0, limite) : filas

  return {
    mensajes: pagina.map(aMensaje).reverse(),
    cursor: pagina.at(-1)?.ordenado_en ?? null,
    hayMas,
  }
}

/** Un mensaje suelto, para cuando Realtime avisa de uno nuevo. */
export async function obtenerMensaje(id: string): Promise<Mensaje | null> {
  const { data, error } = await supabase.from('whatsapp_messages').select(COLUMNAS).eq('id', id).maybeSingle()
  if (error || !data) return null
  return aMensaje(data as unknown as FilaMensaje)
}

/**
 * URL firmada de un adjunto.
 *
 * El bucket es privado y la URL dura cinco minutos. Una URL pública es una URL
 * que se reenvía y queda abierta para siempre, y acá hay fotos y documentos de
 * clientes.
 */
export async function urlDeAdjunto(rutaStorage: string): Promise<string> {
  const { data, error } = await supabase.storage.from('whatsapp').createSignedUrl(rutaStorage, 300)
  if (error || !data) throw new Error('No se pudo abrir el archivo')
  return data.signedUrl
}

export type ErrorEnvio =
  | 'TEMPLATE_REQUIRED'
  | 'SIN_ACCESO'
  | 'SIN_PERMISO'
  | 'CUENTA_INACTIVA'
  | 'integracion_incompleta'
  | 'meta_rechazo'
  | 'meta_inalcanzable'
  | 'otro'

export class FalloDeEnvio extends Error {
  constructor(
    readonly codigo: ErrorEnvio,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'FalloDeEnvio'
  }
}

const TEXTO_DE: Partial<Record<ErrorEnvio, string>> = {
  TEMPLATE_REQUIRED:
    'Pasaron más de 24 horas desde el último mensaje del cliente. Para escribirle hace falta una plantilla aprobada por Meta.',
  SIN_ACCESO: 'No tenés acceso a esta conversación.',
  SIN_PERMISO: 'Tu rol no envía mensajes de WhatsApp.',
  CUENTA_INACTIVA: 'El número de WhatsApp de la empresa está desactivado.',
  integracion_incompleta: 'Falta terminar de configurar la integración con Meta.',
  meta_inalcanzable: 'No se pudo contactar a WhatsApp. El mensaje no salió.',
}

/**
 * Manda un mensaje de texto.
 *
 * `clientRequestId` lo genera el navegador y es obligatorio: es lo que hace
 * que dos clics en Enviar dejen UN mensaje y no dos. Meta no tiene clave de
 * idempotencia propia, así que la ponemos nosotros.
 */
export async function enviarTexto(
  conversacionId: string,
  texto: string,
  clientRequestId: string,
): Promise<{ messageId: string; estado: string }> {
  const { data: sesion } = await supabase.auth.getSession()
  const token = sesion.session?.access_token
  if (!token) throw new FalloDeEnvio('otro', 'Tu sesión venció. Volvé a entrar.')

  const env = getEnv()
  const respuesta = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/whatsapp-send-message`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      conversation_id: conversacionId,
      texto,
      client_request_id: clientRequestId,
    }),
  })

  const cuerpo = (await respuesta.json().catch(() => ({}))) as {
    message_id?: string
    estado?: string
    error?: string
    detalle?: string
  }

  if (!respuesta.ok) {
    const codigo = (cuerpo.error ?? 'otro') as ErrorEnvio
    throw new FalloDeEnvio(
      codigo,
      cuerpo.detalle ?? TEXTO_DE[codigo] ?? 'No se pudo enviar el mensaje.',
    )
  }

  return { messageId: cuerpo.message_id ?? '', estado: cuerpo.estado ?? 'sent' }
}
