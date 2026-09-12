/**
 * El servicio HTTP, sobre Cloud Run.
 *
 * Cinco rutas, y ninguna abierta:
 *
 *   POST /gmail/push    ← Pub/Sub, con OIDC validado acá además de por IAM
 *   POST /gmail/watch   ← Cloud Scheduler, con OIDC de su propia SA
 *   POST /gmail/sync    ← recuperación manual, mismo OIDC que el scheduler
 *   GET  /gmail/thread  ← la UI, con el JWT de Supabase del usuario
 *   GET  /gmail/attachment
 *   GET  /salud
 *
 * Lo que NO hay acá: envío, borradores, etiquetas, archivar, spam, papelera, ni
 * marcar leído en Gmail. La entrega 3 no muta el buzón salvo `users.watch`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { leerConfig, buzonPermitido, type Config } from './config.js'
import { AlmacenSupabase, type Almacen, type CuentaEmail } from './almacen.js'
import { ProveedorDeTokens } from './google/auth.js'
import { ClienteGmailReal, ErrorGmail, type ClienteGmail } from './google/gmail.js'
import { validarOidc, leerMensajePubsub, TokenInvalido } from './oidc.js'
import { sincronizar } from './sync.js'

const INSTANCIA = `cloudrun-${process.pid}-${Math.random().toString(36).slice(2, 8)}`

/** Logs estructurados. NUNCA cuerpos, tokens, aserciones ni la service key. */
function log(nivel: 'info' | 'error', evento: string, datos: Record<string, unknown> = {}): void {
  const linea = JSON.stringify({ severity: nivel.toUpperCase(), evento, ...datos })
  if (nivel === 'error') console.error(linea)
  else console.log(linea)
}

function responder(res: ServerResponse, codigo: number, cuerpo: unknown): void {
  res.writeHead(codigo, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(cuerpo))
}

async function leerCuerpo(req: IncomingMessage): Promise<unknown> {
  const trozos: Buffer[] = []
  for await (const t of req) trozos.push(t as Buffer)
  const txt = Buffer.concat(trozos).toString('utf8')
  return txt ? JSON.parse(txt) : {}
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization
  if (!h || !h.startsWith('Bearer ')) return null
  return h.slice(7)
}

/**
 * Resuelve el buzón a impersonar. **Las dos barreras, siempre.**
 *
 * 1. La dirección sale de `email_accounts`, nunca del request.
 * 2. Y además tiene que estar en el allowlist del servicio.
 *
 * La segunda existe porque la primera no alcanza: si alguien lograra insertar
 * una fila con otra dirección del dominio, sin el allowlist ya tendría lectura
 * de ese buzón.
 */
function verificarBuzon(cfg: Config, cuenta: CuentaEmail): void {
  if (!buzonPermitido(cfg.buzones, cuenta.email_address)) {
    throw new Error(`el buzón de la cuenta ${cuenta.id} no está en el allowlist`)
  }
}

interface Contexto {
  cfg: Config
  almacen: Almacen
  gmail: ClienteGmail
  tokens: ProveedorDeTokens
}

// ── /gmail/push ────────────────────────────────────────────────────────────
async function manejarPush(ctx: Contexto, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const t = bearer(req)
  if (!t) return responder(res, 401, { error: 'sin token' })
  try {
    await validarOidc(t, {
      audience: ctx.cfg.pubsubAudience,
      emailServiceAccount: ctx.cfg.pubsubPushSa,
    })
  } catch (e) {
    log('error', 'push.oidc_invalido', { motivo: (e as Error).message })
    return responder(res, 401, { error: 'token inválido' })
  }

  const mensaje = leerMensajePubsub(await leerCuerpo(req))
  if (!mensaje) {
    // Ack: reintentarlo daría el mismo resultado.
    log('error', 'push.cuerpo_invalido')
    return responder(res, 200, { ok: true, ignorado: 'cuerpo inválido' })
  }

  const cuenta = await ctx.almacen.cuentaPorDireccion(mensaje.emailAddress)
  if (!cuenta) {
    log('error', 'push.cuenta_desconocida')
    return responder(res, 200, { ok: true, ignorado: 'cuenta desconocida' })
  }
  try {
    verificarBuzon(ctx.cfg, cuenta)
  } catch {
    log('error', 'push.buzon_no_permitido', { account_id: cuenta.id })
    return responder(res, 200, { ok: true, ignorado: 'buzón no permitido' })
  }

  // Inline, no encolado: a ~28 mails/día un sync toca uno o dos hilos y termina
  // muy por debajo del ack deadline de 60 s. Encolar agregaría una pieza —otra
  // cola, otro reintento— para un problema que hoy no existe. Si el volumen
  // creciera, el lease ya deja lista la separación.
  try {
    const r = await sincronizar({
      cuenta,
      gmail: ctx.gmail,
      almacen: ctx.almacen,
      duenoLease: INSTANCIA,
      historyIdEvento: mensaje.historyId,
      origen: 'push',
      ventanaResync: ctx.cfg.ventanaResync,
      maxHilosResync: ctx.cfg.maxHilosResync,
    })
    log('info', 'push.ok', {
      account_id: cuenta.id,
      hilos: r.hilosTocados,
      history_id: r.historyIdFinal,
      resync: r.resyncCompleto,
      omitido_por_lease: r.omitidoPorLease,
    })
    return responder(res, 200, { ok: true })
  } catch (e) {
    const err = e as Error
    await ctx.almacen.registrarError(cuenta.id, err.message)
    await ctx.almacen.registrarSync({
      account_id: cuenta.id, kind: 'push', error_details: err.message.slice(0, 500),
    })
    log('error', 'push.fallo', { account_id: cuenta.id, error: err.message })
    if (e instanceof ErrorGmail && !e.reintentable) {
      // 401/403: reintentar en loop no lo arregla. Se ackea y queda el error
      // anotado para que alguien lo mire.
      return responder(res, 200, { ok: false, permanente: true })
    }
    // Reintentable: NO se ackea. Ackear lo que no se pudo procesar es perder el
    // evento en silencio, que es justo el defecto que esta fase corrige.
    return responder(res, 500, { error: 'fallo reintentable' })
  }
}

// ── /gmail/watch y /gmail/sync ─────────────────────────────────────────────
async function exigirScheduler(ctx: Contexto, req: IncomingMessage): Promise<void> {
  const t = bearer(req)
  if (!t) throw new TokenInvalido('sin token')
  await validarOidc(t, {
    audience: ctx.cfg.pubsubAudience,
    emailServiceAccount: ctx.cfg.schedulerSa,
  })
}

async function manejarWatch(ctx: Contexto, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await exigirScheduler(ctx, req)
  } catch {
    return responder(res, 401, { error: 'no autorizado' })
  }

  const cuentas = await ctx.almacen.cuentasActivas()
  const salida: Array<{ account_id: string; ok: boolean }> = []
  for (const cuenta of cuentas) {
    try {
      verificarBuzon(ctx.cfg, cuenta)
      const w = await ctx.gmail.iniciarWatch(cuenta.email_address, ctx.cfg.topicPubsub)
      await ctx.almacen.guardarWatch(cuenta.id, w.historyId, w.expiration, ctx.cfg.topicPubsub)
      await ctx.almacen.registrarSync({
        account_id: cuenta.id, kind: 'watch_renovado', history_id_hasta: w.historyId,
      })
      // Red para las notificaciones perdidas: si el historyId del watch se
      // adelantó al cursor, hay cambios sin sincronizar.
      if (cuenta.last_history_id && BigInt(w.historyId) > BigInt(cuenta.last_history_id)) {
        await sincronizar({
          cuenta, gmail: ctx.gmail, almacen: ctx.almacen,
          duenoLease: INSTANCIA, historyIdEvento: w.historyId, origen: 'cron',
          ventanaResync: ctx.cfg.ventanaResync, maxHilosResync: ctx.cfg.maxHilosResync,
        })
      }
      salida.push({ account_id: cuenta.id, ok: true })
      log('info', 'watch.renovado', { account_id: cuenta.id, expira: w.expiration })
    } catch (e) {
      const err = e as Error
      // Si falla, NO se borra el watch anterior: mientras no venza, sigue
      // sirviendo. Un intento por corrida; el backoff lo da la corrida siguiente.
      await ctx.almacen.registrarError(cuenta.id, err.message)
      salida.push({ account_id: cuenta.id, ok: false })
      log('error', 'watch.fallo', { account_id: cuenta.id, error: err.message })
    }
  }
  return responder(res, 200, { cuentas: salida })
}

async function manejarSyncManual(ctx: Contexto, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await exigirScheduler(ctx, req)
  } catch {
    return responder(res, 401, { error: 'no autorizado' })
  }
  const cuerpo = (await leerCuerpo(req)) as { account_id?: string; ventana?: string; max?: number }
  if (!cuerpo.account_id) return responder(res, 400, { error: 'falta account_id' })

  const cuenta = await ctx.almacen.cuentaPorId(cuerpo.account_id)
  if (!cuenta) return responder(res, 404, { error: 'cuenta desconocida' })
  verificarBuzon(ctx.cfg, cuenta)

  const r = await sincronizar({
    cuenta, gmail: ctx.gmail, almacen: ctx.almacen, duenoLease: INSTANCIA, origen: 'manual',
    // Se puede pisar por request para una corrida puntual, pero el default
    // manda: nunca traer el buzón entero sin querer.
    ventanaResync: cuerpo.ventana ?? ctx.cfg.ventanaResync,
    maxHilosResync: cuerpo.max ?? ctx.cfg.maxHilosResync,
  })
  log('info', 'sync.manual', { account_id: cuenta.id, hilos: r.hilosTocados })
  return responder(res, 200, r)
}

// ── /salud ─────────────────────────────────────────────────────────────────
function manejarSalud(res: ServerResponse): void {
  responder(res, 200, { ok: true, instancia: INSTANCIA })
}

// ── /gmail/perfil ──────────────────────────────────────────────────────────
/**
 * Prueba de vida de la cadena de DWD, sin leer una sola línea de correo.
 *
 *   Cloud Run (SA adjunta) → signJwt → jwt-bearer → Gmail users.getProfile
 *
 * `users.getProfile` no muta nada y no devuelve contenido: sólo la dirección
 * —que ya conocemos, está en el allowlist—, el historyId y un total de
 * mensajes. Es lo mínimo que demuestra que la delegación funciona.
 *
 * Queda como diagnóstico permanente: si algún día la delegación se revoca o el
 * scope cambia, ésta es la llamada que lo dice sin tocar el buzón.
 */
async function manejarPerfil(ctx: Contexto, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await exigirScheduler(ctx, req)
  } catch {
    return responder(res, 401, { error: 'no autorizado' })
  }
  const cuerpo = (await leerCuerpo(req)) as { buzon?: string }
  // El buzón NUNCA se toma tal cual del request: se exige que esté en el
  // allowlist, igual que en cualquier otro camino.
  const buzon = (cuerpo.buzon ?? [...ctx.cfg.buzones][0] ?? '').toLowerCase()
  if (!buzonPermitido(ctx.cfg.buzones, buzon)) {
    return responder(res, 403, { error: 'buzón no permitido' })
  }
  try {
    const p = await ctx.gmail.perfil(buzon)
    log('info', 'perfil.ok', { buzon, history_id: p.historyId })
    return responder(res, 200, {
      ok: true,
      emailAddress: p.emailAddress,
      historyId: p.historyId,
      messagesTotal: p.messagesTotal,
    })
  } catch (e) {
    const err = e as Error
    log('error', 'perfil.fallo', { buzon, error: err.message })
    return responder(res, 502, { ok: false, error: err.message.slice(0, 300) })
  }
}

export function construirServidor(ctx: Contexto) {
  return createServer((req, res) => {
    const ruta = (req.url ?? '').split('?')[0]
    const manejar = async (): Promise<void> => {
      if (req.method === 'GET' && ruta === '/salud') return manejarSalud(res)
      if (req.method === 'POST' && ruta === '/gmail/push') return manejarPush(ctx, req, res)
      if (req.method === 'POST' && ruta === '/gmail/watch') return manejarWatch(ctx, req, res)
      if (req.method === 'POST' && ruta === '/gmail/sync') return manejarSyncManual(ctx, req, res)
      if (req.method === 'POST' && ruta === '/gmail/perfil') return manejarPerfil(ctx, req, res)
      // /gmail/thread y /gmail/attachment llegan en la entrega 4, junto con la
      // bandeja: sin UI que los consuma, exponerlos ahora sería superficie sin
      // uso. El cliente de Gmail ya tiene los métodos listos.
      responder(res, 404, { error: 'ruta desconocida' })
    }
    manejar().catch((e) => {
      log('error', 'no_manejado', { error: (e as Error).message })
      responder(res, 500, { error: 'error interno' })
    })
  })
}

if (process.env['NODE_ENV'] !== 'test') {
  const cfg = leerConfig()
  const tokens = new ProveedorDeTokens(cfg.serviceAccount, cfg.scopeGmail)
  const ctx: Contexto = {
    cfg,
    almacen: new AlmacenSupabase(cfg.supabaseUrl, cfg.supabaseServiceKey),
    gmail: new ClienteGmailReal((buzon) => tokens.para(buzon)),
    tokens,
  }
  const puerto = Number(process.env['PORT'] ?? 8080)
  construirServidor(ctx).listen(puerto, () => {
    log('info', 'arranque', { puerto, buzones: cfg.buzones.size })
  })
}
