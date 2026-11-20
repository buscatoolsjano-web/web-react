import { getEnv } from '@/lib/env'
import { supabase } from '@/services/supabase/client'
import type { EntidadMantenimiento } from './adjuntos'

/**
 * Videos de Mantenimiento: a YouTube, privados, no a Supabase.
 *
 * El archivo va del navegador DIRECTO a YouTube. La Edge Function
 * `youtube-video` abre la sesión de subida (con la credencial del canal, que
 * nunca baja al navegador) y después confirma que el video exista antes de
 * guardar el link. En la base queda sólo el id del video.
 */

export interface VideoMantenimiento {
  id: string
  youtubeId: string
  titulo: string
  bytes: number | null
  subidoEn: string
}

export interface EstadoYoutube {
  conectado: boolean
  canal: string | null
}

/** Hasta 1 GB: ya no ocupa el bucket. Lo grabado en el ingreso (2 min) anda por los 30 MB. */
export const LIMITE_BYTES_YOUTUBE = 1024 * 1024 * 1024

export const urlDeYoutube = (youtubeId: string) => `https://www.youtube.com/watch?v=${youtubeId}`

async function llamar<T>(ruta: string, metodo: 'GET' | 'POST', cuerpo?: Record<string, unknown>, params?: Record<string, string>): Promise<T> {
  const { data: sesion } = await supabase.auth.getSession()
  const token = sesion.session?.access_token
  if (!token) throw new Error('Se cerró la sesión. Volvé a entrar.')
  const env = getEnv()
  const qs = params ? `?${new URLSearchParams(params)}` : ''
  let r: Response
  try {
    r = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/youtube-video${ruta}${qs}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.VITE_SUPABASE_ANON_KEY,
        ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
    })
  } catch {
    throw new Error('No hay conexión con el servidor. Revisá internet y probá de nuevo.')
  }
  const j = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (!r.ok) throw new Error(j.error ?? `Falló el pedido (${r.status}).`)
  return j
}

export async function estadoYoutube(companyId: string): Promise<EstadoYoutube> {
  const { data, error } = await supabase.rpc('youtube_estado', { p_company: companyId })
  if (error) throw new Error(`No se pudo saber si YouTube está conectado: ${error.message}`)
  const d = data as unknown as { conectado: boolean; canal: string | null }
  return { conectado: d.conectado, canal: d.canal }
}

/** Lleva a la pantalla de Google para elegir el canal. Sólo admin. */
export async function conectarYoutube(companyId: string): Promise<void> {
  const { url } = await llamar<{ url: string }>('/oauth/start', 'GET', undefined, { company: companyId })
  window.location.href = url
}

export async function videosDe(companyId: string, entidad: EntidadMantenimiento, entidadId: string): Promise<VideoMantenimiento[]> {
  const { data, error } = await supabase
    .from('maintenance_videos')
    .select('id, youtube_video_id, title, bytes, created_at')
    .eq('company_id', companyId)
    .eq('entity_type', entidad)
    .eq('entity_id', entidadId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`No se pudieron leer los videos: ${error.message}`)
  return (data ?? []).map((v) => ({
    id: v.id,
    youtubeId: v.youtube_video_id,
    titulo: v.title,
    bytes: v.bytes,
    subidoEn: v.created_at,
  }))
}

/** El PUT a YouTube con progreso: `fetch` no informa cuánto subió. */
function subirConProgreso(url: string, archivo: File, onProgreso?: (fraccion: number) => void): Promise<{ id?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', archivo.type || 'video/*')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgreso?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as { id?: string })
        } catch {
          resolve({})
        }
      } else reject(new Error(`YouTube rechazó el video (${xhr.status}).`))
    }
    xhr.onerror = () => reject(new Error('Se cortó la subida a YouTube. Revisá internet y probá de nuevo.'))
    xhr.send(archivo)
  })
}

export async function subirVideo(
  companyId: string,
  entidad: EntidadMantenimiento,
  entidadId: string,
  archivo: File,
  onProgreso?: (fraccion: number) => void,
): Promise<void> {
  if (archivo.size > LIMITE_BYTES_YOUTUBE) {
    throw new Error(`El video pesa ${(archivo.size / 1024 / 1024).toFixed(0)} MB y el máximo es 1 GB.`)
  }
  const mime = archivo.type || 'video/*'
  const { uploadUrl, titulo } = await llamar<{ uploadUrl: string; titulo: string }>('/iniciar', 'POST', {
    company: companyId,
    entidad,
    entidadId,
    bytes: archivo.size,
    mime,
  })
  const video = await subirConProgreso(uploadUrl, archivo, onProgreso)
  if (!video.id) throw new Error('YouTube no devolvió el video subido.')
  await llamar('/registrar', 'POST', { company: companyId, entidad, entidadId, videoId: video.id, bytes: archivo.size, mime, titulo })
}

export async function quitarVideo(companyId: string, id: string): Promise<void> {
  await llamar('/quitar', 'POST', { company: companyId, id })
}
