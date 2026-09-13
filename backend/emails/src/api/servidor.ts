/**
 * El servicio que usa la bandeja: `buscatools-erp-email-api`.
 *
 * Es un servicio de Cloud Run APARTE del que recibe el push, a propósito. El
 * navegador no puede conseguir un token de identidad de Google, así que este
 * servicio tiene que aceptar invocaciones sin IAM y autenticar en el código con
 * el JWT de Supabase. Si viviera en el mismo servicio, `/gmail/push`, `/gmail/watch`
 * y `/gmail/sync` perderían su primera barrera —IAM—.
 *
 * Tres rutas y nada más:
 *
 *   GET /salud
 *   GET /gmail/thread?account_id=…&thread_id=…
 *   GET /gmail/attachment?account_id=…&thread_id=…&message_id=…&part_id=…
 *
 * Ninguna muta Gmail. `threads.get`, `messages.get` y `attachments.get` son
 * lecturas: no quitan la etiqueta UNREAD.
 *
 * Y no tiene la service key de Supabase: autoriza con el JWT de la persona.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { buzonPermitido } from '../config.js'
import { ErrorGmail, type ClienteGmail } from '../google/gmail.js'
import {
  IndiceNoDisponible,
  NoAutenticado,
  NoEncontrado,
  validar,
  type Autorizador,
  type HiloAutorizado,
} from './autorizacion.js'
import { armarHilo, buscarParte, threadIdDe } from './mensajes.js'
import { createHash } from 'node:crypto'
import { MimeInvalido } from './mime.js'
import { LimiteEnvios, type RegistroEnvios } from './registro.js'
import {
  DatosInvalidos,
  descartarBorrador,
  enviar,
  guardarBorrador,
  listarBorradores,
  obtenerBorradorEditable,
} from './redactar.js'

export interface ContextoApi {
  /** Registro firmado de envíos. Sin él, las rutas de redactar responden 503. */
  registro?: RegistroEnvios
  buzones: ReadonlySet<string>
  origenes: ReadonlySet<string>
  autorizador: Autorizador
  gmail: ClienteGmail
  /** Pedidos por persona por minuto, por instancia. */
  limitePorMinuto?: number
  ahora?: () => number
}

/** Tope de un adjunto: Gmail no deja mandar más de 25 MB. */
const TOPE_ADJUNTO = 25 * 1024 * 1024

function log(nivel: 'info' | 'error', evento: string, datos: Record<string, unknown> = {}): void {
  // NUNCA asunto, remitente, cuerpo, nombre de archivo, JWT ni token de Gmail.
  const linea = JSON.stringify({ severity: nivel.toUpperCase(), evento, ...datos })
  if (nivel === 'error') console.error(linea)
  else console.log(linea)
}

function cabecerasCors(ctx: ContextoApi, req: IncomingMessage): Record<string, string> {
  const origen = req.headers.origin
  if (!origen || !ctx.origenes.has(origen)) return { Vary: 'Origin' }
  return {
    'Access-Control-Allow-Origin': origen,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Disposition, Retry-After',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

const SIN_CACHE = {
  // El cuerpo de un mail no se guarda en ningún lado: tampoco en la caché HTTP.
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
}

function json(
  ctx: ContextoApi,
  req: IncomingMessage,
  res: ServerResponse,
  codigo: number,
  cuerpo: unknown,
  extra: Record<string, string> = {},
): void {
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    ...SIN_CACHE,
    ...cabecerasCors(ctx, req),
    ...extra,
  })
  res.end(JSON.stringify(cuerpo))
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization
  if (!h || !h.startsWith('Bearer ')) return null
  const t = h.slice(7).trim()
  return t.split('.').length === 3 ? t : null
}

/** Ventana fija por persona. Alcanza para cortar un loop del frontend. */
class Ritmo {
  private readonly ventanas = new Map<string, { desde: number; n: number }>()
  constructor(
    private readonly limite: number,
    private readonly ahora: () => number,
  ) {}

  permitir(clave: string): boolean {
    const t = this.ahora()
    const v = this.ventanas.get(clave)
    if (!v || t - v.desde >= 60_000) {
      this.ventanas.set(clave, { desde: t, n: 1 })
      if (this.ventanas.size > 5_000) this.ventanas.clear()
      return true
    }
    v.n++
    return v.n <= this.limite
  }
}

/** Traduce un fallo a un código y un mensaje útil, sin el error crudo de Google. */
function responderFallo(
  ctx: ContextoApi,
  req: IncomingMessage,
  res: ServerResponse,
  e: unknown,
  qué: 'hilo' | 'adjunto' | 'borrador' | 'envio',
  datos: Record<string, unknown>,
): void {
  if (e instanceof NoAutenticado) return json(ctx, req, res, 401, { error: 'sesion_invalida' })
  if (e instanceof DatosInvalidos) return json(ctx, req, res, 422, { error: 'datos_invalidos', campo: e.campo })
  if (e instanceof MimeInvalido) return json(ctx, req, res, 422, { error: 'datos_invalidos', campo: e.message })
  if (e instanceof CuerpoDemasiadoGrande) return json(ctx, req, res, 413, { error: 'demasiado_grande' })
  if (e instanceof LimiteEnvios) {
    log('error', 'api.envio.limite', { ...datos, alcance: e.alcance })
    return json(ctx, req, res, 429, { error: 'limite_envios' }, { 'Retry-After': '600' })
  }
  if (e instanceof NoEncontrado) return json(ctx, req, res, 404, { error: `${qué}_no_disponible` })
  if (e instanceof IndiceNoDisponible) {
    log('error', `api.${qué}.indice`, { ...datos, motivo: e.message })
    return json(ctx, req, res, 503, { error: 'indice_no_disponible' }, { 'Retry-After': '30' })
  }
  if (e instanceof ErrorGmail) {
    log('error', `api.${qué}.gmail`, { ...datos, status: e.status })
    if (e.status === 404) return json(ctx, req, res, 404, { error: `${qué}_no_disponible` })
    if (e.status === 429) {
      return json(ctx, req, res, 429, { error: 'gmail_ocupado' }, { 'Retry-After': '30' })
    }
    if (e.status === 401 || e.status === 403) {
      return json(ctx, req, res, 502, { error: 'gmail_no_autorizado' })
    }
    return json(ctx, req, res, 502, { error: 'gmail_no_disponible' }, { 'Retry-After': '30' })
  }
  log('error', `api.${qué}.fallo`, { ...datos, motivo: (e as Error).message?.slice(0, 200) })
  return json(ctx, req, res, 502, { error: 'gmail_no_disponible' })
}

async function autorizar(
  ctx: ContextoApi,
  ritmo: Ritmo,
  req: IncomingMessage,
  params: URLSearchParams,
): Promise<HiloAutorizado> {
  const jwt = bearer(req)
  if (!jwt) throw new NoAutenticado('sin token')
  const accountId = params.get('account_id')
  const threadId = params.get('thread_id')
  // Un id con forma inválida no llega ni a la base.
  if (!validar.uuid(accountId) || !validar.idGmail(threadId)) throw new NoEncontrado('ids inválidos')

  const hilo = await ctx.autorizador.autorizarHilo(jwt, accountId, threadId)
  // La segunda barrera de siempre: aunque la base diga que la cuenta existe,
  // el buzón tiene que estar en el allowlist del servicio.
  if (!buzonPermitido(ctx.buzones, hilo.buzon)) throw new NoEncontrado('buzón fuera del allowlist')
  if (!ritmo.permitir(hilo.usuario)) throw new DemasiadosPedidos()
  return hilo
}

class DemasiadosPedidos extends Error {}

async function manejarHilo(
  ctx: ContextoApi,
  ritmo: Ritmo,
  req: IncomingMessage,
  res: ServerResponse,
  params: URLSearchParams,
): Promise<void> {
  const t0 = Date.now()
  const datos: Record<string, unknown> = { account_id: params.get('account_id') }
  try {
    const hilo = await autorizar(ctx, ritmo, req, params)
    const crudo = await ctx.gmail.hiloCompleto(hilo.buzon, hilo.gmailThreadId)
    const payload = await armarHilo(crudo, (mensajeId, attachmentId) =>
      ctx.gmail.adjunto(hilo.buzon, mensajeId, attachmentId),
    )
    const cuerpo = JSON.stringify(payload)
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      ...SIN_CACHE,
      ...cabecerasCors(ctx, req),
    })
    res.end(cuerpo)
    log('info', 'api.hilo.ok', {
      ...datos,
      mensajes: payload.mensajes.length,
      bytes: Buffer.byteLength(cuerpo),
      ms: Date.now() - t0,
    })
  } catch (e) {
    if (e instanceof DemasiadosPedidos) {
      return json(ctx, req, res, 429, { error: 'demasiadas_solicitudes' }, { 'Retry-After': '60' })
    }
    return responderFallo(ctx, req, res, e, 'hilo', datos)
  }
}

/** `filename*` de RFC 5987: un nombre con acentos o comillas no rompe el header. */
export function disposicion(nombre: string): string {
  const limpio = nombre.replace(/[\r\n"\\/]/g, '_').slice(0, 180) || 'adjunto'
  const ascii = limpio.replace(/[^\x20-\x7e]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(limpio)}`
}

async function manejarAdjunto(
  ctx: ContextoApi,
  ritmo: Ritmo,
  req: IncomingMessage,
  res: ServerResponse,
  params: URLSearchParams,
): Promise<void> {
  const t0 = Date.now()
  const datos: Record<string, unknown> = { account_id: params.get('account_id') }
  try {
    const hilo = await autorizar(ctx, ritmo, req, params)
    const mensajeId = params.get('message_id')
    const partId = params.get('part_id')
    if (!validar.idGmail(mensajeId) || !validar.partId(partId)) throw new NoEncontrado('ids inválidos')

    // Las cuatro piezas, relacionadas: el mensaje tiene que ser de ESE hilo y
    // la parte tiene que existir en ESE mensaje. El attachmentId sale de Gmail
    // en este momento, nunca del request.
    const mensaje = await ctx.gmail.mensajeCompleto(hilo.buzon, mensajeId)
    if (threadIdDe(mensaje) !== hilo.gmailThreadId) throw new NoEncontrado('mensaje de otro hilo')
    const parte = buscarParte(mensaje, partId)
    if (!parte || (!parte.attachmentId && !parte.data)) throw new NoEncontrado('parte inexistente')

    const data = parte.attachmentId
      ? (await ctx.gmail.adjunto(hilo.buzon, mensajeId, parte.attachmentId)).data
      : (parte.data ?? '')
    const bytes = Buffer.from(data, 'base64url')
    if (bytes.length > TOPE_ADJUNTO) throw new NoEncontrado('adjunto demasiado grande')

    res.writeHead(200, {
      // Un HTML o un SVG adjunto se entrega como binario opaco: nunca se
      // interpreta en el origen del servicio.
      'Content-Type': /^(text\/html|image\/svg|application\/xhtml)/.test(parte.mime)
        ? 'application/octet-stream'
        : parte.mime,
      'Content-Length': String(bytes.length),
      'Content-Disposition': disposicion(parte.nombre || `adjunto-${partId}`),
      'Content-Security-Policy': "default-src 'none'; sandbox",
      ...SIN_CACHE,
      ...cabecerasCors(ctx, req),
    })
    res.end(bytes)
    log('info', 'api.adjunto.ok', { ...datos, bytes: bytes.length, ms: Date.now() - t0 })
  } catch (e) {
    if (e instanceof DemasiadosPedidos) {
      return json(ctx, req, res, 429, { error: 'demasiadas_solicitudes' }, { 'Retry-After': '60' })
    }
    return responderFallo(ctx, req, res, e, 'adjunto', datos)
  }
}

/** Tope del cuerpo de un POST: 10 MB de adjuntos en base64 más el texto. */
export const TOPE_CUERPO_JSON = 15 * 1024 * 1024

class CuerpoDemasiadoGrande extends Error {}

async function leerJson(req: IncomingMessage, tope: number): Promise<unknown> {
  const trozos: Buffer[] = []
  let total = 0
  for await (const t of req) {
    total += (t as Buffer).length
    if (total > tope) throw new CuerpoDemasiadoGrande()
    trozos.push(t as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(trozos).toString('utf8') || '{}')
  } catch {
    throw new DatosInvalidos('json')
  }
}

/**
 * Borradores y envío. Cada operación autoriza adentro, con el JWT, contra la RLS
 * y el allowlist. El ritmo se cuenta por token —no por el `sub` sin verificar—,
 * para que un JWT falso no pueda agotarle el cupo a otra persona.
 */
async function manejarRedactar(
  ctx: ContextoApi,
  ritmo: Ritmo,
  req: IncomingMessage,
  res: ServerResponse,
  ruta: string,
  params: URLSearchParams,
): Promise<void> {
  const t0 = Date.now()
  const qué = ruta === '/gmail/send' ? 'envio' : 'borrador'
  const datos: Record<string, unknown> = { ruta, metodo: req.method }
  try {
    const jwt = bearer(req)
    if (!jwt) throw new NoAutenticado('sin token')
    if (!ctx.registro) return json(ctx, req, res, 503, { error: 'envio_no_configurado' })
    if (!ritmo.permitir(createHash('sha256').update(jwt).digest('hex'))) throw new DemasiadosPedidos()
    const c = { buzones: ctx.buzones, autorizador: ctx.autorizador, gmail: ctx.gmail, registro: ctx.registro }
    const cuenta = params.get('account_id')

    if (req.method === 'GET' && ruta === '/gmail/drafts') {
      if (!validar.uuid(cuenta)) throw new NoEncontrado('account_id')
      const hilo = params.get('thread_id')
      if (hilo !== null && !validar.idGmail(hilo)) throw new NoEncontrado('thread_id')
      return json(ctx, req, res, 200, await listarBorradores(c, jwt, cuenta, hilo))
    }
    if (req.method === 'GET' && ruta === '/gmail/draft') {
      if (!validar.uuid(cuenta)) throw new NoEncontrado('account_id')
      // Pista opcional: desde qué hilo y mensaje se abrió. Sólo se usa si el borrador
      // no trae X-BT-Compose ni un In-Reply-To que coincida, y se valida igual.
      const refPista = params.get('ref_message_id')
      const hiloPista = params.get('thread_id')
      const pista = {
        modo: params.get('modo'),
        ref_message_id: validar.idGmail(refPista) ? refPista : null,
        thread_id: validar.idGmail(hiloPista) ? hiloPista : null,
      }
      return json(ctx, req, res, 200, await obtenerBorradorEditable(c, jwt, cuenta, params.get('draft_id') ?? '', pista))
    }
    if (req.method === 'DELETE' && ruta === '/gmail/draft') {
      if (!validar.uuid(cuenta)) throw new NoEncontrado('account_id')
      return json(ctx, req, res, 200, await descartarBorrador(c, jwt, cuenta, params.get('draft_id') ?? ''))
    }
    if (req.method === 'POST' && ruta === '/gmail/draft') {
      const r = await guardarBorrador(c, jwt, await leerJson(req, TOPE_CUERPO_JSON))
      log('info', 'api.borrador.ok', { ...datos, recreado: r.recreado, adjuntos: r.adjuntos.length, ms: Date.now() - t0 })
      return json(ctx, req, res, 200, r)
    }
    if (req.method === 'POST' && ruta === '/gmail/send') {
      const r = await enviar(c, jwt, await leerJson(req, TOPE_CUERPO_JSON))
      log(r.estado === 'incierto' && r.motivo === 'conflicto' ? 'error' : 'info', 'api.envio.resultado', { ...datos, estado: r.estado, ...(r.estado === 'incierto' ? { motivo: r.motivo } : {}), ms: Date.now() - t0 })
      const codigo = r.estado === 'enviado' ? 200 : r.estado === 'fallido' ? 502 : 202
      return json(ctx, req, res, codigo, r)
    }
    return json(ctx, req, res, 405, { error: 'metodo_no_permitido' })
  } catch (e) {
    if (e instanceof DemasiadosPedidos) {
      return json(ctx, req, res, 429, { error: 'demasiadas_solicitudes' }, { 'Retry-After': '60' })
    }
    return responderFallo(ctx, req, res, e, qué, datos)
  }
}

export function construirServidorApi(ctx: ContextoApi) {
  const ritmo = new Ritmo(ctx.limitePorMinuto ?? 120, ctx.ahora ?? Date.now)
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local')
    const ruta = url.pathname
    const manejar = async (): Promise<void> => {
      if (req.method === 'OPTIONS') {
        const cors = cabecerasCors(ctx, req)
        res.writeHead('Access-Control-Allow-Origin' in cors ? 204 : 403, cors)
        return void res.end()
      }
      if (req.method === 'GET' && ruta === '/salud') return json(ctx, req, res, 200, { ok: true })
      if (req.method === 'GET' && ruta === '/gmail/thread') {
        return manejarHilo(ctx, ritmo, req, res, url.searchParams)
      }
      if (req.method === 'GET' && ruta === '/gmail/attachment') {
        return manejarAdjunto(ctx, ritmo, req, res, url.searchParams)
      }
      if (ruta === '/gmail/drafts' || ruta === '/gmail/draft' || ruta === '/gmail/send') {
        return manejarRedactar(ctx, ritmo, req, res, ruta, url.searchParams)
      }
      // Nada de push, watch, sync ni perfil acá: viven en el servicio privado.
      json(ctx, req, res, 404, { error: 'ruta_desconocida' })
    }
    manejar().catch((e) => {
      log('error', 'api.no_manejado', { motivo: (e as Error).message?.slice(0, 200) })
      if (!res.headersSent) json(ctx, req, res, 500, { error: 'error_interno' })
      else res.end()
    })
  })
}
