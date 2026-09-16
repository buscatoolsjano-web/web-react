/**
 * whatsapp-webhook — la única puerta de entrada de Meta al ERP.
 *
 *   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…  → challenge
 *   POST  (firmado con X-Hub-Signature-256)                       → 200
 *
 * Orden de cada POST, sin excepciones:
 *   1. se lee el cuerpo CRUDO (`req.text()`), antes de cualquier parseo;
 *   2. se valida la firma HMAC-SHA256 contra ESE cuerpo;
 *   3. recién entonces se hace `JSON.parse`;
 *   4. se normaliza y se procesa cada evento con una RPC idempotente;
 *   5. se contesta 200 lo antes posible; la media se baja después, en segundo
 *      plano, porque Meta corta por tiempo y reintenta.
 *
 * Esta función NO lleva `verify_jwt`: la llama Meta, que no tiene JWT. Lo que
 * la protege es la firma. Por eso la validación de firma no tiene ninguna vía
 * de escape: sin `META_WHATSAPP_APP_SECRET` cargado, rechaza todo.
 *
 * Nunca se registra: el cuerpo del mensaje del cliente, la firma recibida ni
 * la esperada, el token, el secreto ni ningún header de autorización.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  idDeEvento,
  normalizarPayload,
  resolverHandshake,
  verificarFirma,
  type EventoMensaje,
  type EventoNormalizado,
} from './logica.ts'

const URL_BASE = Deno.env.get('SUPABASE_URL')!
const CLAVE_SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_SECRET = Deno.env.get('META_WHATSAPP_APP_SECRET')
const VERIFY_TOKEN = Deno.env.get('META_WHATSAPP_VERIFY_TOKEN')
const ACCESS_TOKEN = Deno.env.get('META_WHATSAPP_ACCESS_TOKEN')
const GRAPH = Deno.env.get('META_GRAPH_VERSION') ?? 'v23.0'

/** Meta documenta 100 MB para documentos; el bucket tiene el mismo techo. */
const MAX_MEDIA_BYTES = 100 * 1024 * 1024
const BUCKET = 'whatsapp'

const admin = createClient(URL_BASE, CLAVE_SERVICIO, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Una línea por pedido, sin contenido del cliente ni secretos. */
function registrar(datos: Record<string, unknown>) {
  console.log(JSON.stringify({ fn: 'whatsapp-webhook', ...datos }))
}

/** Un wamid completo identifica un mensaje: en el log va sólo la cola. */
const idCorto = (id: string) => (id.length <= 12 ? id : `…${id.slice(-10)}`)

function texto(status: number, cuerpo: string): Response {
  return new Response(cuerpo, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/**
 * Bitácora de diagnóstico.
 *
 * `whatsapp_webhook_events` NO es un espejo de todo lo que manda Meta: se
 * escribe SÓLO cuando algo sale mal. Guardar cada payload para siempre es
 * exactamente lo que infló la base en el sistema anterior, y el mensaje ya
 * queda en `whatsapp_messages`, que es donde se lee.
 *
 * El payload que se guarda es el evento normalizado y recortado —sin el texto
 * del cliente—, no el cuerpo crudo.
 */
async function anotarProblema(
  evento: EventoNormalizado | null,
  tipo: string,
  detalle: string,
  extra: Record<string, unknown> = {},
) {
  const { error } = await admin.from('whatsapp_webhook_events').insert({
    provider_event_id: evento ? idDeEvento(evento) : `${tipo}:${Date.now()}`,
    event_type: tipo,
    payload: {
      clase: evento?.clase ?? null,
      phone_number_id: evento?.phoneNumberId ?? null,
      waba_id: evento?.wabaId ?? null,
      provider_message_id: evento?.providerMessageId ?? null,
      ...extra,
    },
    signature_ok: true,
    error_details: detalle.slice(0, 500),
  })
  // Un fallo de la bitácora no puede tumbar el webhook.
  if (error && !error.message.includes('duplicate key')) {
    registrar({ evento: 'bitacora_fallida', detalle: error.message.slice(0, 120) })
  }
}

/** Un entrante: una sola RPC, que es además la que garantiza la idempotencia. */
async function procesarMensaje(e: EventoMensaje): Promise<{ ok: boolean; mediaId: string | null }> {
  const { data, error } = await admin.rpc('registrar_entrante_whatsapp', {
    p_phone_number_id: e.phoneNumberId,
    p_waba_id: e.wabaId,
    p_wa_id: e.waId,
    p_profile_name: e.profileName,
    p_provider_message_id: e.providerMessageId,
    p_tipo: e.tipo,
    p_texto: e.texto,
    p_caption: e.caption,
    p_reply_to: e.replyTo,
    p_timestamp: e.timestamp,
    p_media: e.media,
  })

  if (error) {
    await anotarProblema(e, 'entrante_error', error.message)
    return { ok: false, mediaId: null }
  }

  const r = (data ?? {}) as { resultado?: string; media_id?: string | null }
  if (r.resultado === 'cuenta_desconocida') {
    // No es un error nuestro: es un evento de una cuenta que no administramos.
    await anotarProblema(e, 'cuenta_desconocida', 'phone_number_id sin cuenta activa')
    return { ok: true, mediaId: null }
  }
  if (e.tipo === 'unknown') {
    await anotarProblema(e, 'tipo_desconocido', `tipo crudo: ${e.tipoCrudo}`, { tipo_crudo: e.tipoCrudo })
  }

  return { ok: true, mediaId: r.resultado === 'creado' ? (r.media_id ?? null) : null }
}

/** Un acuse. Cada estado tiene su columna, así que un acuse atrasado no retrocede. */
async function procesarEstado(e: Extract<EventoNormalizado, { clase: 'estado' }>): Promise<boolean> {
  const { error } = await admin.rpc('registrar_estado_whatsapp', {
    p_phone_number_id: e.phoneNumberId,
    p_provider_message_id: e.providerMessageId,
    p_estado: e.estado,
    p_timestamp: e.timestamp,
    p_error_code: e.errorCode,
    p_error_details: e.errorDetalle,
  })
  if (error) {
    await anotarProblema(e, 'estado_error', error.message)
    return false
  }
  return true
}

/**
 * Baja un archivo de Meta y lo deja en Storage.
 *
 * Corre DESPUÉS de contestarle a Meta (`EdgeRuntime.waitUntil`): bajar 90 MB
 * antes del 200 es garantía de timeout y de reintento, y el reintento traería
 * el mismo mensaje otra vez.
 *
 * El binario nunca toca Postgres. En la base queda la ruta.
 */
async function bajarMedia(mediaId: string) {
  if (!ACCESS_TOKEN) {
    await admin.rpc('sellar_media_whatsapp', {
      p_media: mediaId, p_storage_path: null, p_size_bytes: null,
      p_mime_type: null, p_error_details: 'sin token de acceso configurado',
    })
    return
  }

  const { data: fila, error } = await admin
    .from('whatsapp_media')
    .select('id, company_id, conversation_id, provider_media_id, mime_type, file_name, status')
    .eq('id', mediaId)
    .maybeSingle()
  // Ya descargada: no se vuelve a pedir. Meta cobra ancho de banda y el
  // archivo no cambia.
  if (error || !fila || fila.status === 'descargada' || !fila.provider_media_id) return

  const fallar = (motivo: string) =>
    admin.rpc('sellar_media_whatsapp', {
      p_media: mediaId, p_storage_path: null, p_size_bytes: null,
      p_mime_type: null, p_error_details: motivo.slice(0, 500),
    })

  try {
    // 1 · Meta da una URL temporal, no el archivo.
    const meta = await fetch(`https://graph.facebook.com/${GRAPH}/${fila.provider_media_id}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    })
    if (!meta.ok) return void (await fallar(`graph ${meta.status}`))
    const info = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number }
    if (!info.url) return void (await fallar('respuesta sin url'))
    if (typeof info.file_size === 'number' && info.file_size > MAX_MEDIA_BYTES) {
      return void (await fallar(`demasiado grande: ${info.file_size} bytes`))
    }

    // 2 · La descarga también va firmada con el token; la URL sola no alcanza.
    const archivo = await fetch(info.url, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } })
    if (!archivo.ok) return void (await fallar(`descarga ${archivo.status}`))
    const bytes = new Uint8Array(await archivo.arrayBuffer())
    if (bytes.byteLength > MAX_MEDIA_BYTES) {
      return void (await fallar(`demasiado grande: ${bytes.byteLength} bytes`))
    }

    // 3 · A Storage. El bucket es privado y la ruta NO es la seguridad: la
    //     policy se ata a la conversación.
    const mime = info.mime_type ?? fila.mime_type ?? 'application/octet-stream'
    const ruta = `${fila.company_id}/${fila.conversation_id}/${mediaId}`
    const subida = await admin.storage.from(BUCKET).upload(ruta, bytes, {
      contentType: mime,
      upsert: true,
    })
    if (subida.error) return void (await fallar(`storage: ${subida.error.message}`))

    await admin.rpc('sellar_media_whatsapp', {
      p_media: mediaId,
      p_storage_path: ruta,
      p_size_bytes: bytes.byteLength,
      p_mime_type: mime,
      p_error_details: null,
    })
    registrar({ evento: 'media_descargada', media: idCorto(mediaId), bytes: bytes.byteLength })
  } catch (e) {
    await fallar(e instanceof Error ? e.message : 'error inesperado')
  }
}

Deno.serve(async (req) => {
  const inicio = Date.now()
  const pedido = crypto.randomUUID().slice(0, 8)
  const url = new URL(req.url)

  // ── GET: el handshake de Meta ────────────────────────────────────────────
  if (req.method === 'GET') {
    const r = resolverHandshake(url.searchParams, VERIFY_TOKEN)
    registrar({ pedido, metodo: 'GET', evento: 'handshake', resultado: r.status })
    return texto(r.status, r.body)
  }

  if (req.method !== 'POST') return texto(405, 'Method Not Allowed')

  // ── POST: primero el cuerpo crudo, después la firma, después el parseo ───
  const rawBody = await req.text()
  const motivo = await verificarFirma(rawBody, req.headers.get('x-hub-signature-256'), APP_SECRET)
  if (motivo !== 'ok') {
    registrar({ pedido, metodo: 'POST', evento: 'firma_rechazada', motivo, ms: Date.now() - inicio })
    // 403 y nada más: no se parsea, no se guarda, no se procesa.
    return texto(403, 'Forbidden')
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    registrar({ pedido, evento: 'json_invalido', ms: Date.now() - inicio })
    return texto(400, 'Bad Request')
  }

  const eventos = normalizarPayload(payload)
  if (eventos.length === 0) {
    registrar({ pedido, evento: 'sin_eventos', bytes: rawBody.length, ms: Date.now() - inicio })
    return texto(200, 'EVENT_RECEIVED')
  }

  const media: string[] = []
  let ok = 0
  let fallados = 0

  for (const e of eventos) {
    if (e.clase === 'mensaje') {
      const r = await procesarMensaje(e)
      if (r.ok) ok++
      else fallados++
      if (r.mediaId) media.push(r.mediaId)
    } else {
      if (await procesarEstado(e)) ok++
      else fallados++
    }
  }

  // La media se baja después del 200. `EdgeRuntime` sólo existe en la
  // plataforma; en local se hace igual, en serie.
  if (media.length > 0) {
    const trabajo = (async () => {
      for (const m of media) await bajarMedia(m)
    })()
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
    if (runtime?.waitUntil) runtime.waitUntil(trabajo)
    else await trabajo
  }

  registrar({
    pedido,
    evento: 'procesado',
    eventos: eventos.length,
    ok,
    fallados,
    media: media.length,
    ms: Date.now() - inicio,
  })

  // Si TODO falló, conviene que Meta reintente: casi siempre es la base
  // momentáneamente caída. Si falló sólo una parte, reintentar el lote entero
  // repetiría los que ya entraron, y esos ya están protegidos por la
  // idempotencia — pero el reintento no arregla un evento permanentemente malo.
  if (ok === 0 && fallados > 0) return texto(500, 'Internal Error')
  return texto(200, 'EVENT_RECEIVED')
})
