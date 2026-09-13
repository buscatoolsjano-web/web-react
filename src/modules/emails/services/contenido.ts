import { supabase } from '@/services/supabase/client'
import { getEnv } from '@/lib/env'
import { ErrorContenido, clasificarRespuesta } from '../lib/errores'
import type { HiloContenido } from '../types'

/**
 * El CONTENIDO del correo, desde Gmail, a través del servicio de Cloud Run.
 *
 * El navegador nunca habla con Gmail: no recibe un token de Google ni una URL de
 * Gmail. Manda su JWT de Supabase y el servicio decide con la RLS.
 *
 * Lo que vuelve vive en memoria del componente. No se guarda en Supabase, ni
 * en localStorage, ni en la caché HTTP (el servicio responde `no-store`).
 */

function base(): string {
  const url = getEnv().VITE_EMAILS_API_URL
  if (!url) throw new ErrorContenido('no_configurado')
  return url.replace(/\/+$/, '')
}

async function jwt(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ErrorContenido('sesion_invalida', 401)
  return token
}

export interface OpcionesPedido {
  metodo?: 'GET' | 'POST' | 'DELETE'
  cuerpo?: unknown
  /** Estados que NO son error para esta ruta (p. ej. 202 de un envío incierto). */
  aceptar?: number[]
}

/** Un pedido al servicio de la bandeja. Exportado para el composer (services/redactar). */
export async function pedir(
  ruta: string,
  params: Record<string, string>,
  senal?: AbortSignal,
  opciones: OpcionesPedido = {},
): Promise<Response> {
  const url = `${base()}${ruta}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`
  let r: Response
  try {
    r = await fetch(url, {
      method: opciones.metodo ?? 'GET',
      headers: {
        Authorization: `Bearer ${await jwt()}`,
        ...(opciones.cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(opciones.cuerpo !== undefined ? { body: JSON.stringify(opciones.cuerpo) } : {}),
      // Nada de cookies: la identidad va en el header, y sólo ahí.
      credentials: 'omit',
      cache: 'no-store',
      ...(senal ? { signal: senal } : {}),
    })
  } catch (e) {
    if (e instanceof ErrorContenido) throw e
    if ((e as Error).name === 'AbortError') throw e
    throw new ErrorContenido('sin_red')
  }
  // 200 siempre es éxito; otro 2xx sólo si la ruta lo declara (el 202 de un envío
  // en curso o incierto NO es un error, pero tampoco es «enviado»).
  if (r.status !== 200 && !(opciones.aceptar ?? []).includes(r.status)) {
    const cuerpo: unknown = await r.clone().json().catch(() => null)
    const retry = Number(r.headers.get('Retry-After'))
    throw new ErrorContenido(clasificarRespuesta(r.status, cuerpo), r.status, Number.isFinite(retry) && retry > 0 ? retry : null, cuerpo)
  }
  return r
}

export async function traerHilo(
  accountId: string,
  gmailThreadId: string,
  senal?: AbortSignal,
): Promise<{ hilo: HiloContenido; bytes: number }> {
  const r = await pedir('/gmail/thread', { account_id: accountId, thread_id: gmailThreadId }, senal)
  const texto = await r.text()
  return { hilo: JSON.parse(texto) as HiloContenido, bytes: new Blob([texto]).size }
}

export async function traerAdjunto(
  accountId: string,
  gmailThreadId: string,
  mensajeId: string,
  partId: string,
  senal?: AbortSignal,
): Promise<Blob> {
  const r = await pedir(
    '/gmail/attachment',
    { account_id: accountId, thread_id: gmailThreadId, message_id: mensajeId, part_id: partId },
    senal,
  )
  return r.blob()
}

/** Una imagen inline como data URI, para el iframe (que no ve blob: de otro origen). */
export async function imagenInline(
  accountId: string,
  gmailThreadId: string,
  mensajeId: string,
  partId: string,
  mime: string,
  senal?: AbortSignal,
): Promise<string | null> {
  if (!/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(mime)) return null
  const blob = await traerAdjunto(accountId, gmailThreadId, mensajeId, partId, senal)
  if (blob.size > 3 * 1024 * 1024) return null
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binario = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:${mime.toLowerCase()};base64,${btoa(binario)}`
}

/** Guarda el adjunto en la máquina de la persona. Sólo cuando lo pide. */
export function guardarEnDisco(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
