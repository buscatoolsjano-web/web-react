/**
 * Videos de Mantenimiento a YouTube (privados).
 *
 * El video NO pasa por acá ni por Supabase: el navegador lo sube directo a
 * YouTube por una sesión de subida que esta función abre. Acá se hace lo que
 * necesita la credencial del canal, que nunca llega al navegador:
 *
 *   GET  /oauth/start?company=…   (admin) URL de «Conectar YouTube».
 *   GET  /oauth/callback          vuelta de Google: guarda el refresh token.
 *   POST /iniciar                 abre la sesión de subida con el título de la orden.
 *   POST /registrar               comprueba en YouTube que el video exista y guarda el link.
 *   POST /quitar                  lo borra de YouTube y saca el link.
 *
 * Se despliega con verify_jwt apagado porque Google vuelve a /oauth/callback
 * sin sesión; las demás rutas verifican el JWT acá, a mano.
 *
 * Secrets: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET (Google Cloud, cliente
 * OAuth «Aplicación web»). APP_URL opcional (default app.buscatools.com).
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0'
import { descripcionDeVideo, esIdDeYoutube, tituloDeVideo } from './logica.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const CLIENT_ID = Deno.env.get('YOUTUBE_CLIENT_ID') ?? ''
const CLIENT_SECRET = Deno.env.get('YOUTUBE_CLIENT_SECRET') ?? ''
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://app.buscatools.com').replace(/\/$/, '')
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/youtube-video/oauth/callback`
// Subir, leer y borrar videos del canal: un solo permiso.
const SCOPE = 'https://www.googleapis.com/auth/youtube'

const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
})

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const falla = (mensaje: string, status = 400) => json({ error: mensaje }, status)

type Entidad = 'maintenance_order' | 'maintenance_asset'
const esEntidad = (s: unknown): s is Entidad => s === 'maintenance_order' || s === 'maintenance_asset'

/**
 * Quién llama, con qué rol en esa empresa, y si entra a Mantenimiento.
 *
 * Lo de Mantenimiento lo decide la base, no esta función: se llama a
 * `youtube_estado()` con el token de la persona, que falla si su rol no tiene
 * el módulo (la misma regla que la RLS de las tablas de Mantenimiento).
 */
async function quien(
  req: Request,
  companyId: string,
): Promise<{ userId: string; rol: string; mantenimiento: boolean } | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (jwt === '' || companyId === '') return null
  const { data, error } = await admin.auth.getUser(jwt)
  if (error || !data.user) return null
  const { data: m } = await admin
    .from('company_memberships')
    .select('role')
    .eq('company_id', companyId)
    .eq('user_id', data.user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!m) return null
  const comoElUsuario = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error: sinModulo } = await comoElUsuario.rpc('youtube_estado', { p_company: companyId })
  return { userId: data.user.id, rol: m.role as string, mantenimiento: !sinModulo }
}

class SinConexion extends Error {}

/** Un access token del canal de la empresa, a partir del refresh token guardado. */
async function tokenDeAcceso(companyId: string): Promise<string> {
  const { data } = await admin.from('youtube_connections').select('refresh_token').eq('company_id', companyId).maybeSingle()
  if (!data) throw new SinConexion('YouTube no está conectado para esta empresa: un administrador tiene que conectarlo.')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: data.refresh_token as string,
      grant_type: 'refresh_token',
    }),
  })
  const t = (await r.json()) as { access_token?: string; error?: string }
  if (!r.ok || !t.access_token) {
    if (t.error === 'invalid_grant') {
      // El permiso se revocó o venció: se borra para que la pantalla ofrezca reconectar.
      await admin.from('youtube_connections').delete().eq('company_id', companyId)
      throw new SinConexion('Se perdió el permiso de YouTube: un administrador tiene que volver a conectarlo.')
    }
    throw new Error('Google no dio acceso a YouTube. Probá de nuevo en un rato.')
  }
  return t.access_token
}

/** Referencia, equipo y cliente de la orden o del equipo, para el título. */
async function datosDeEntidad(companyId: string, entidad: Entidad, id: string) {
  if (entidad === 'maintenance_order') {
    const { data } = await admin
      .from('maintenance_orders')
      .select('number, equipo:maintenance_assets!asset_id ( model_text, serial_number ), cliente:customers!customer_id ( legal_name )')
      .eq('company_id', companyId)
      .eq('id', id)
      .maybeSingle()
    if (!data) return null
    const d = data as unknown as {
      number: string
      equipo: { model_text: string | null; serial_number: string | null } | null
      cliente: { legal_name: string } | null
    }
    return { referencia: d.number, modelo: d.equipo?.model_text ?? null, serie: d.equipo?.serial_number ?? null, cliente: d.cliente?.legal_name ?? null }
  }
  const { data } = await admin
    .from('maintenance_assets')
    .select('reference, model_text, serial_number, cliente:customers!owner_customer_id ( legal_name )')
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle()
  if (!data) return null
  const d = data as unknown as {
    reference: string
    model_text: string | null
    serial_number: string | null
    cliente: { legal_name: string } | null
  }
  return { referencia: d.reference, modelo: d.model_text, serie: d.serial_number, cliente: d.cliente?.legal_name ?? null }
}

const hoyAr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  const ruta = url.pathname.replace(/^.*\/youtube-video/, '') || '/'

  if (CLIENT_ID === '' || CLIENT_SECRET === '') {
    return falla('Falta configurar YOUTUBE_CLIENT_ID y YOUTUBE_CLIENT_SECRET en los secrets de Supabase.', 503)
  }

  try {
    // ── Conectar el canal ───────────────────────────────────────────────
    if (req.method === 'GET' && ruta === '/oauth/start') {
      const companyId = url.searchParams.get('company') ?? ''
      const q = await quien(req, companyId)
      if (!q || q.rol !== 'admin') return falla('Sólo un administrador de la empresa conecta YouTube.', 403)
      const state = crypto.randomUUID()
      // Los `state` viejos que nadie usó se limpian de paso.
      await admin.from('youtube_oauth_states').delete().lt('created_at', new Date(Date.now() - 15 * 60_000).toISOString())
      const { error } = await admin.from('youtube_oauth_states').insert({ state, company_id: companyId, user_id: q.userId })
      if (error) throw new Error(error.message)
      const consentimiento = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      consentimiento.search = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        // `consent` para que Google devuelva SIEMPRE un refresh token.
        prompt: 'consent select_account',
        state,
      }).toString()
      return json({ url: consentimiento.toString() })
    }

    if (req.method === 'GET' && ruta === '/oauth/callback') {
      const volver = (p: string) => Response.redirect(`${APP_URL}/mantenimiento/ordenes?${p}`, 302)
      const state = url.searchParams.get('state') ?? ''
      const code = url.searchParams.get('code') ?? ''
      if (url.searchParams.get('error')) return volver('youtube=cancelado')
      const { data: st } = await admin.from('youtube_oauth_states').select('*').eq('state', state).maybeSingle()
      if (!st || Date.now() - new Date(st.created_at as string).getTime() > 15 * 60_000) return volver('youtube=vencido')
      await admin.from('youtube_oauth_states').delete().eq('state', state)

      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      })
      const t = (await r.json()) as { access_token?: string; refresh_token?: string }
      if (!r.ok || !t.refresh_token || !t.access_token) return volver('youtube=error')

      const c = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
        headers: { Authorization: `Bearer ${t.access_token}` },
      })
      const canal = (await c.json()) as { items?: { id: string; snippet: { title: string } }[] }
      const item = canal.items?.[0]
      if (!item) return volver('youtube=sin_canal')

      const { error } = await admin.from('youtube_connections').upsert({
        company_id: st.company_id,
        refresh_token: t.refresh_token,
        channel_id: item.id,
        channel_title: item.snippet.title,
        connected_by: st.user_id,
        connected_at: new Date().toISOString(),
      })
      if (error) return volver('youtube=error')
      return volver('youtube=conectado')
    }

    if (req.method !== 'POST') return falla('Ruta desconocida.', 404)
    const cuerpo = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const companyId = typeof cuerpo.company === 'string' ? cuerpo.company : ''
    const q = await quien(req, companyId)
    if (!q || !q.mantenimiento) return falla('Sin permiso en Mantenimiento de esta empresa.', 403)

    // ── Abrir la subida ─────────────────────────────────────────────────
    if (ruta === '/iniciar') {
      const { entidad, entidadId, bytes, mime } = cuerpo
      if (!esEntidad(entidad) || typeof entidadId !== 'string') return falla('Falta la orden o el equipo.')
      if (typeof bytes !== 'number' || bytes <= 0) return falla('El video está vacío.')
      const datos = await datosDeEntidad(companyId, entidad, entidadId)
      if (!datos) return falla('La orden o el equipo no existe en esta empresa.', 404)

      const titulo = tituloDeVideo({ ...datos, fecha: hoyAr() })
      const token = await tokenDeAcceso(companyId)
      const origen = req.headers.get('Origin') ?? APP_URL
      const r = await fetch(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Length': String(bytes),
            'X-Upload-Content-Type': typeof mime === 'string' && mime !== '' ? mime : 'video/*',
            // Con el Origin del navegador, la URL de subida acepta el PUT directo (CORS).
            Origin: origen,
          },
          body: JSON.stringify({
            snippet: { title: titulo, description: descripcionDeVideo(entidad, datos.referencia), categoryId: '28' },
            status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
          }),
        },
      )
      const uploadUrl = r.headers.get('Location')
      if (!r.ok || !uploadUrl) {
        const detalle = await r.text()
        if (detalle.includes('quotaExceeded') || detalle.includes('uploadLimitExceeded')) {
          return falla('YouTube no acepta más subidas por hoy (cupo diario de la API). Probá mañana.', 429)
        }
        return falla('YouTube no abrió la subida. Probá de nuevo en un rato.', 502)
      }
      return json({ uploadUrl, titulo })
    }

    // ── Guardar el link ─────────────────────────────────────────────────
    if (ruta === '/registrar') {
      const { entidad, entidadId, videoId, bytes, mime, titulo } = cuerpo
      if (!esEntidad(entidad) || typeof entidadId !== 'string' || !esIdDeYoutube(videoId)) return falla('Datos incompletos.')
      if (!(await datosDeEntidad(companyId, entidad, entidadId))) return falla('La orden o el equipo no existe en esta empresa.', 404)

      // Que el video exista y sea del canal conectado: no se guarda un id cualquiera.
      const token = await tokenDeAcceso(companyId)
      const { data: con } = await admin.from('youtube_connections').select('channel_id').eq('company_id', companyId).single()
      const v = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const vj = (await v.json()) as { items?: { snippet: { channelId: string; title: string } }[] }
      const item = vj.items?.[0]
      if (!item || item.snippet.channelId !== con?.channel_id) return falla('Ese video no está en el canal de la empresa.', 400)

      const { data, error } = await admin
        .from('maintenance_videos')
        .insert({
          company_id: companyId,
          entity_type: entidad,
          entity_id: entidadId,
          youtube_video_id: videoId,
          title: typeof titulo === 'string' && titulo !== '' ? titulo : item.snippet.title,
          bytes: typeof bytes === 'number' ? bytes : null,
          mime_type: typeof mime === 'string' ? mime : null,
          created_by: q.userId,
        })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      return json({ id: data.id })
    }

    // ── Quitar ──────────────────────────────────────────────────────────
    if (ruta === '/quitar') {
      const id = typeof cuerpo.id === 'string' ? cuerpo.id : ''
      const { data: fila } = await admin
        .from('maintenance_videos')
        .select('id, youtube_video_id')
        .eq('company_id', companyId)
        .eq('id', id)
        .maybeSingle()
      if (!fila) return falla('El video no existe.', 404)
      const token = await tokenDeAcceso(companyId)
      const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${fila.youtube_video_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      // 404: ya lo habían borrado en YouTube. Igual se saca el link.
      if (!r.ok && r.status !== 404) return falla('YouTube no dejó borrar el video. Probá de nuevo en un rato.', 502)
      await admin.from('maintenance_videos').delete().eq('id', fila.id)
      return json({ ok: true })
    }

    return falla('Ruta desconocida.', 404)
  } catch (e) {
    if (e instanceof SinConexion) return falla(e.message, 409)
    console.error('youtube-video', e instanceof Error ? e.message : e)
    return falla('Falló la comunicación con YouTube. Probá de nuevo en un rato.', 500)
  }
})
