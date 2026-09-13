/**
 * Redactar, responder, reenviar y borradores — contra Gmail, bajo la
 * autorización del usuario del ERP.
 *
 *   GET    /gmail/drafts      borradores del buzón (o de un hilo)
 *   GET    /gmail/draft       un borrador, listo para seguir editando
 *   POST   /gmail/draft       crear o actualizar
 *   DELETE /gmail/draft       descartar (drafts.delete es definitivo)
 *   POST   /gmail/send        enviar, con idempotencia por client_request_id
 *
 * Gmail es la única persistencia de borradores y enviados. Nada de esto guarda
 * cuerpo, destinatarios ni adjuntos en Supabase.
 *
 * Lo que el cliente NO decide nunca:
 *   · el From — sale de la cuenta autorizada;
 *   · el HTML — lo arma `redaccion.ts` desde texto;
 *   · el hilo, In-Reply-To y References de una respuesta — salen del mensaje
 *     original leído de Gmail y validado contra el hilo autorizado;
 *   · el asunto de una respuesta — Gmail exige que coincida para mantener el hilo.
 */
import { randomUUID } from 'node:crypto'
import { CABECERA_REQUEST_ID, ErrorGmail, type ClienteGmail } from '../google/gmail.js'
import { ResultadoIncierto } from '../google/reintentos.js'
import { NoEncontrado, validar, type Autorizador } from './autorizacion.js'
import { analizarMensaje, buscarParte, threadIdDe } from './mensajes.js'
import {
  MimeInvalido,
  aplanar,
  construirMime,
  direccionValida,
  type AdjuntoSaliente,
  type Direccion,
} from './mime.js'
import { asuntoReenvio, asuntoRespuesta, cita, referencias, separarCita, textoAHtml, type Modo, type Original } from './redaccion.js'
import type { RegistroEnvios } from './registro.js'

export const LIMITES = {
  /** Total de adjuntos por mensaje. Decisión de la v1, por debajo de lo que acepta Gmail. */
  bytesAdjuntos: 10 * 1024 * 1024,
  adjuntos: 20,
  destinatarios: 100,
  textoPropio: 100_000,
  asunto: 500,
  /** Un reservado más viejo que esto sin completar se trata como incierto. */
  reservaVencidaMs: 120_000,
  /** Ventana de reconciliación en SENT alrededor del último intento: antes (reloj) y después (reintentos + timeout). */
  reconciliarAntesMs: 5 * 60_000,
  reconciliarDespuesMs: 15 * 60_000,
}

export class DatosInvalidos extends Error {
  constructor(readonly campo: string) {
    super(`datos_invalidos:${campo}`)
    this.name = 'DatosInvalidos'
  }
}

export interface ContextoRedactar {
  buzones: ReadonlySet<string>
  autorizador: Autorizador
  gmail: ClienteGmail
  registro: RegistroEnvios
}

export type AdjuntoEntrada =
  | { tipo: 'nuevo'; nombre: string; mime: string; datos: string }
  | { tipo: 'borrador'; part_id: string }
  | { tipo: 'original'; message_id: string; part_id: string }

export interface EntradaRedaccion {
  account_id: string
  modo: Modo
  thread_id?: string | null
  ref_message_id?: string | null
  draft_id?: string | null
  para: string[]
  cc: string[]
  cco: string[]
  asunto: string
  texto: string
  adjuntos: AdjuntoEntrada[]
}

const MODOS: readonly Modo[] = ['nuevo', 'responder', 'responder_todos', 'reenviar']
/**
 * Los únicos campos que se aceptan. Un `from`, `de`, `reply_to`, `headers` o
 * `raw` no se ignora en silencio: se rechaza, así un cliente que intenta elegir el
 * remitente o colar cabeceras se entera antes de tocar la base o Gmail.
 */
const CAMPOS = new Set(['account_id', 'modo', 'thread_id', 'ref_message_id', 'draft_id', 'para', 'cc', 'cco', 'asunto', 'texto', 'adjuntos', 'client_request_id'])
const CAMPOS_ADJUNTO = new Set(['tipo', 'nombre', 'mime', 'datos', 'part_id', 'message_id'])
/** Controles en el asunto (CR, LF, NUL…): intento de inyectar cabeceras. El tab se tolera. */
const CONTROL_EN_ASUNTO = /[\u0000-\u0008\u000a-\u001f\u007f]/
const ID_BORRADOR = /^[A-Za-z0-9_-]{6,80}$/

/** Valida la forma de la entrada. Nada de acá toca Gmail ni la base. */
export function leerEntrada(crudo: unknown, paraEnviar: boolean): EntradaRedaccion {
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) throw new DatosInvalidos('cuerpo')
  const c = crudo as Record<string, unknown>
  for (const k of Object.keys(c)) if (!CAMPOS.has(k)) throw new DatosInvalidos('campo_desconocido')
  const texto = (v: unknown, campo: string, max: number): string => {
    if (v === undefined || v === null) return ''
    if (typeof v !== 'string') throw new DatosInvalidos(campo)
    if (v.length > max) throw new DatosInvalidos(campo)
    return v
  }
  const accountId = typeof c['account_id'] === 'string' ? c['account_id'] : null
  if (!validar.uuid(accountId)) throw new DatosInvalidos('account_id')
  const modo = c['modo'] as Modo
  if (!MODOS.includes(modo)) throw new DatosInvalidos('modo')

  const threadId = c['thread_id'] ?? null
  const refId = c['ref_message_id'] ?? null
  const draftId = c['draft_id'] ?? null
  if (modo !== 'nuevo') {
    if (typeof threadId !== 'string' || !validar.idGmail(threadId)) throw new DatosInvalidos('thread_id')
    if (typeof refId !== 'string' || !validar.idGmail(refId)) throw new DatosInvalidos('ref_message_id')
  }
  if (draftId !== null && (typeof draftId !== 'string' || !ID_BORRADOR.test(draftId))) throw new DatosInvalidos('draft_id')

  const vistos = new Set<string>()
  const lista = (v: unknown, campo: string): string[] => {
    if (v === undefined || v === null) return []
    if (!Array.isArray(v)) throw new DatosInvalidos(campo)
    const salida: string[] = []
    for (const d of v) {
      if (typeof d !== 'string') throw new DatosInvalidos(campo)
      const limpia = d.trim().toLowerCase()
      if (limpia === '') continue
      // Un CR/LF, una coma o un «<» en una dirección son intentos de inyectar
      // cabeceras o destinatarios: se rechaza, no se «limpia».
      if (!direccionValida(limpia)) throw new DatosInvalidos(campo)
      if (vistos.has(limpia)) continue
      vistos.add(limpia)
      salida.push(limpia)
    }
    return salida
  }
  const para = lista(c['para'], 'para')
  const cc = lista(c['cc'], 'cc')
  const cco = lista(c['cco'], 'cco')
  if (para.length + cc.length + cco.length > LIMITES.destinatarios) throw new DatosInvalidos('destinatarios')
  if (paraEnviar && para.length + cc.length + cco.length === 0) throw new DatosInvalidos('destinatarios')

  const adjuntosCrudos = c['adjuntos'] ?? []
  if (!Array.isArray(adjuntosCrudos) || adjuntosCrudos.length > LIMITES.adjuntos) throw new DatosInvalidos('adjuntos')
  const adjuntos: AdjuntoEntrada[] = adjuntosCrudos.map((a: unknown) => {
    if (typeof a !== 'object' || a === null || Array.isArray(a)) throw new DatosInvalidos('adjuntos')
    const x = a as Record<string, unknown>
    for (const k of Object.keys(x)) if (!CAMPOS_ADJUNTO.has(k)) throw new DatosInvalidos('adjuntos')
    if (x['tipo'] === 'nuevo') {
      if (typeof x['nombre'] !== 'string' || typeof x['mime'] !== 'string' || typeof x['datos'] !== 'string') {
        throw new DatosInvalidos('adjuntos')
      }
      if (!/^[A-Za-z0-9+/=_-]*$/.test(x['datos'])) throw new DatosInvalidos('adjuntos')
      return { tipo: 'nuevo', nombre: x['nombre'].slice(0, 255), mime: x['mime'].slice(0, 127), datos: x['datos'] }
    }
    if (x['tipo'] === 'borrador' && typeof x['part_id'] === 'string' && validar.partId(x['part_id'])) {
      return { tipo: 'borrador', part_id: x['part_id'] }
    }
    if (
      x['tipo'] === 'original' &&
      typeof x['message_id'] === 'string' && validar.idGmail(x['message_id']) &&
      typeof x['part_id'] === 'string' && validar.partId(x['part_id'])
    ) {
      return { tipo: 'original', message_id: x['message_id'], part_id: x['part_id'] }
    }
    throw new DatosInvalidos('adjuntos')
  })

  const asuntoCrudo = texto(c['asunto'], 'asunto', LIMITES.asunto * 4)
  if (CONTROL_EN_ASUNTO.test(asuntoCrudo)) throw new DatosInvalidos('asunto')

  return {
    account_id: accountId,
    modo,
    thread_id: typeof threadId === 'string' ? threadId : null,
    ref_message_id: typeof refId === 'string' ? refId : null,
    draft_id: typeof draftId === 'string' ? draftId : null,
    para,
    cc,
    cco,
    asunto: aplanar(asuntoCrudo).slice(0, LIMITES.asunto),
    texto: texto(c['texto'], 'texto', LIMITES.textoPropio),
    adjuntos,
  }
}

const CABECERAS_REF = ['Message-ID', 'References', 'Subject', 'From', 'To', 'Cc', 'Reply-To', 'Date']

interface Preparado {
  raw: Buffer
  threadId: string | null
  buzon: string
  usuario: string
  accountId: string
}

interface Autorizado {
  buzon: string
  nombre: string | null
  usuario: string
  accountId: string
}

async function autorizar(ctx: ContextoRedactar, jwt: string, e: EntradaRedaccion): Promise<Autorizado> {
  const cuenta = await ctx.autorizador.autorizarCuenta(jwt, e.account_id)
  if (e.modo !== 'nuevo') {
    // Una respuesta o un reenvío tiene que ser sobre un hilo que la RLS le deja ver.
    await ctx.autorizador.autorizarHilo(jwt, e.account_id, e.thread_id!)
  }
  const buzon = cuenta.buzon.trim().toLowerCase()
  if (!ctx.buzones.has(buzon)) throw new NoEncontrado('buzón fuera del allowlist')
  return { buzon: cuenta.buzon, nombre: cuenta.nombre, usuario: cuenta.usuario, accountId: cuenta.accountId }
}

/** El mensaje original de una respuesta o un reenvío, validado contra el hilo. */
async function original(ctx: ContextoRedactar, buzon: string, e: EntradaRedaccion) {
  if (e.modo === 'nuevo') return null
  const cab = await ctx.gmail.mensajeCabeceras(buzon, e.ref_message_id!, CABECERAS_REF)
  if (cab.threadId !== e.thread_id) throw new NoEncontrado('el mensaje no es de ese hilo')
  const completo = await ctx.gmail.mensajeCompleto(buzon, e.ref_message_id!)
  const p = analizarMensaje(completo as Parameters<typeof analizarMensaje>[0]).payload
  const o: Original = {
    de: p.de,
    para: p.para,
    cc: p.cc,
    fecha: p.fecha,
    asunto: p.asunto,
    texto: p.texto,
    html: p.html,
  }
  return { cab, original: o, completo }
}

async function bytesDeParte(
  ctx: ContextoRedactar,
  buzon: string,
  mensaje: unknown,
  mensajeId: string,
  partId: string,
): Promise<{ nombre: string; mime: string; bytes: Buffer }> {
  const parte = buscarParte(mensaje, partId)
  if (!parte || (!parte.attachmentId && !parte.data)) throw new DatosInvalidos('adjuntos')
  const data = parte.attachmentId ? (await ctx.gmail.adjunto(buzon, mensajeId, parte.attachmentId)).data : parte.data!
  return { nombre: parte.nombre || `adjunto-${partId}`, mime: parte.mime, bytes: Buffer.from(data, 'base64url') }
}

function dominio(buzon: string): string {
  return buzon.split('@')[1] ?? 'buscatools.invalid'
}

/**
 * Arma el MIME.
 *
 * El Message-ID es aleatorio y NO es una clave: Gmail lo reemplaza al guardar
 * (medido en producción el 13/9). La identidad de un envío viaja en
 * `X-BT-Request-Id` (el client_request_id); la de un borrador es el draftId que
 * devuelve Gmail. Un borrador lleva además `X-BT-Compose` (modo y referencia),
 * sólo como dato para retomarlo: el envío final no la lleva.
 */
async function preparar(
  ctx: ContextoRedactar,
  jwt: string,
  e: EntradaRedaccion,
  opciones: { borrador: true } | { borrador: false; requestId: string },
): Promise<Preparado> {
  const a = await autorizar(ctx, jwt, e)
  const ref = await original(ctx, a.buzon, e)

  // Adjuntos que ya estaban en el borrador: se leen del borrador actual.
  let borradorMensaje: unknown = null
  let borradorMensajeId: string | null = null
  if (e.adjuntos.some((x) => x.tipo === 'borrador')) {
    if (!e.draft_id) throw new DatosInvalidos('draft_id')
    const b = await ctx.gmail.obtenerBorrador(a.buzon, e.draft_id)
    borradorMensaje = b.message
    borradorMensajeId = (b.message as { id?: string } | null)?.id ?? null
    if (!borradorMensajeId) throw new NoEncontrado('borrador sin mensaje')
  }

  const adjuntos: AdjuntoSaliente[] = []
  let total = 0
  for (const x of e.adjuntos) {
    let adj: { nombre: string; mime: string; bytes: Buffer }
    if (x.tipo === 'nuevo') {
      adj = { nombre: x.nombre, mime: x.mime, bytes: Buffer.from(x.datos, 'base64') }
    } else if (x.tipo === 'borrador') {
      adj = await bytesDeParte(ctx, a.buzon, borradorMensaje, borradorMensajeId!, x.part_id)
    } else {
      // Sólo los adjuntos del mensaje que se está reenviando o respondiendo.
      if (!ref || x.message_id !== e.ref_message_id || threadIdDe(ref.completo) !== e.thread_id) {
        throw new DatosInvalidos('adjuntos')
      }
      adj = await bytesDeParte(ctx, a.buzon, ref.completo, x.message_id, x.part_id)
    }
    total += adj.bytes.length
    if (total > LIMITES.bytesAdjuntos) throw new DatosInvalidos('adjuntos_tamano')
    adjuntos.push(adj)
  }

  let asunto = e.asunto
  let threadId: string | null = null
  let inReplyTo: string | null = null
  let references: string | null = null
  if (ref && (e.modo === 'responder' || e.modo === 'responder_todos')) {
    asunto = asuntoRespuesta(ref.cab.cabeceras['subject'] ?? '')
    threadId = e.thread_id!
    const r = referencias(ref.cab.cabeceras['message-id'], ref.cab.cabeceras['references'])
    inReplyTo = r.inReplyTo
    references = r.references
  } else if (ref && e.modo === 'reenviar') {
    asunto = e.asunto.trim() || asuntoReenvio(ref.cab.cabeceras['subject'] ?? '')
  }

  const c = cita(e.modo, ref?.original ?? null)
  const dir = (d: string): Direccion => ({ direccion: d })
  const raw = construirMime({
    de: { direccion: a.buzon, nombre: a.nombre },
    para: e.para.map(dir),
    cc: e.cc.map(dir),
    cco: e.cco.map(dir),
    asunto,
    messageId: `<bt.${randomUUID()}@${dominio(a.buzon)}>`,
    inReplyTo,
    references,
    texto: e.texto + c.texto,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${textoAHtml(e.texto)}${c.html}</div>`,
    adjuntos,
    ...(opciones.borrador
      ? {
          borrador: true,
          cabecerasExtra: {
            'X-BT-Compose': `v1; modo=${e.modo}; ref=${e.ref_message_id ?? ''}; thread=${e.thread_id ?? ''}`,
          },
        }
      : { cabecerasExtra: { [CABECERA_REQUEST_ID]: opciones.requestId } }),
  })
  return { raw, threadId, buzon: a.buzon, usuario: a.usuario, accountId: a.accountId }
}

function partesVisibles(mensaje: unknown) {
  return analizarMensaje(mensaje as Parameters<typeof analizarMensaje>[0])
    .payload.adjuntos.filter((x) => !x.inline)
    .map((x) => ({ part_id: x.partId, nombre: x.nombre, mime: x.mime, tamano: x.tamano }))
}

// ── Borradores ─────────────────────────────────────────────────────────────

export async function guardarBorrador(ctx: ContextoRedactar, jwt: string, crudo: unknown) {
  const e = leerEntrada(crudo, false)
  const p = await preparar(ctx, jwt, e, { borrador: true })
  let r
  if (e.draft_id) {
    try {
      r = await ctx.gmail.actualizarBorrador(p.buzon, e.draft_id, p.raw, p.threadId)
    } catch (err) {
      // Borrado fuera del ERP (en Gmail, o por otro usuario): se crea uno nuevo
      // y se avisa, en vez de romper.
      if (err instanceof ErrorGmail && err.status === 404) {
        r = await ctx.gmail.crearBorrador(p.buzon, p.raw, p.threadId)
        return { ...(await respuestaBorrador(ctx, p.buzon, r, e)), recreado: true }
      }
      throw err
    }
  } else {
    r = await ctx.gmail.crearBorrador(p.buzon, p.raw, p.threadId)
  }
  return { ...(await respuestaBorrador(ctx, p.buzon, r, e)), recreado: false }
}

async function respuestaBorrador(
  ctx: ContextoRedactar,
  buzon: string,
  r: { id: string; messageId: string; threadId: string },
  e: EntradaRedaccion,
) {
  // Los partId del borrador cambian con cada update: si hay adjuntos, se leen
  // de nuevo para que el cliente los referencie bien en el guardado siguiente.
  const adjuntos = e.adjuntos.length > 0 ? partesVisibles((await ctx.gmail.obtenerBorrador(buzon, r.id)).message) : []
  return { draft_id: r.id, thread_id: r.threadId, adjuntos }
}

function cabecera(mensaje: unknown, nombre: string): string {
  const hs = (mensaje as { payload?: { headers?: Array<{ name?: string; value?: string }> } } | null)?.payload?.headers ?? []
  return hs.find((h) => h.name?.toLowerCase() === nombre.toLowerCase())?.value ?? ''
}

export function direcciones(valor: string): string[] {
  return [...new Set((valor.match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? []).map((d) => d.toLowerCase()))].filter(direccionValida)
}

/**
 * De dónde salió el modo de un borrador retomado:
 *   cabecera     X-BT-Compose, puesta por el ERP al guardarlo
 *   in_reply_to  sin X-BT-Compose: el In-Reply-To del borrador coincide EXACTO con
 *                el Message-ID de UN mensaje de su hilo (Gmail conserva esa cabecera)
 *   contexto     sin nada de lo anterior: lo que dice la pantalla desde donde se
 *                abrió (hilo + mensaje), validado contra Gmail y la RLS
 *   sin_datos    se retoma como mail nuevo; el contenido queda intacto
 *
 * La IDENTIDAD del borrador es siempre el draftId de Gmail. X-BT-Compose es un
 * dato para retomarlo, no la forma de encontrarlo.
 */
export type OrigenModoBorrador = 'cabecera' | 'in_reply_to' | 'contexto' | 'sin_datos'

export interface PistaBorrador {
  modo: string | null
  ref_message_id: string | null
  thread_id: string | null
}

const SIN_PISTA: PistaBorrador = { modo: null, ref_message_id: null, thread_id: null }

function mensajeIdsDelHilo(hilo: unknown): Array<{ id: string; messageId: string }> {
  const ms = (hilo as { messages?: Array<{ id?: string }> } | null)?.messages ?? []
  return ms.filter((x) => x.id).map((x) => ({ id: x.id!, messageId: cabecera(x, 'Message-ID').trim() }))
}

export async function obtenerBorradorEditable(
  ctx: ContextoRedactar,
  jwt: string,
  accountId: string,
  draftId: string,
  pista: PistaBorrador = SIN_PISTA,
) {
  if (!ID_BORRADOR.test(draftId)) throw new NoEncontrado('draft_id')
  const cuenta = await ctx.autorizador.autorizarCuenta(jwt, accountId)
  if (!ctx.buzones.has(cuenta.buzon.trim().toLowerCase())) throw new NoEncontrado('allowlist')
  const b = await ctx.gmail.obtenerBorrador(cuenta.buzon, draftId)
  const m = b.message
  const payload = analizarMensaje(m as Parameters<typeof analizarMensaje>[0]).payload
  const hiloBorrador = threadIdDe(m)

  const compose = cabecera(m, 'X-BT-Compose')
  const leer = (k: string) => new RegExp(`${k}=([^;]*)`).exec(compose)?.[1]?.trim() || null
  const modoCabecera = leer('modo') as Modo | null
  const pistaModo = pista.modo as Modo | null

  let modo: Modo = 'nuevo'
  let ref: string | null = null
  // El hilo DEL ORIGINAL: en una respuesta es el del borrador; en un reenvío el
  // borrador vive en un hilo nuevo y el original está en otro.
  let hiloRef: string | null = null
  let origen: OrigenModoBorrador = 'sin_datos'

  if (modoCabecera && MODOS.includes(modoCabecera)) {
    modo = modoCabecera
    ref = leer('ref')
    hiloRef = modo === 'reenviar' ? leer('thread') : hiloBorrador
    origen = 'cabecera'
  } else {
    const inReplyTo = cabecera(m, 'In-Reply-To').trim()
    if (inReplyTo && hiloBorrador && validar.idGmail(hiloBorrador)) {
      const visible = await ctx.autorizador.autorizarHilo(jwt, accountId, hiloBorrador).then(() => true, () => false)
      const hilo = visible ? await ctx.gmail.hiloCompleto(cuenta.buzon, hiloBorrador).catch(() => null) : null
      const exacto = mensajeIdsDelHilo(hilo).filter((x) => x.messageId === inReplyTo)
      if (exacto.length === 1) {
        modo = pistaModo === 'responder_todos' ? 'responder_todos' : 'responder'
        ref = exacto[0]!.id
        hiloRef = hiloBorrador
        origen = 'in_reply_to'
      }
    }
    if (origen === 'sin_datos' && pistaModo && pistaModo !== 'nuevo' && MODOS.includes(pistaModo)) {
      modo = pistaModo
      ref = pista.ref_message_id
      hiloRef = pista.thread_id
      origen = 'contexto'
    }
  }

  let texto = payload.texto ?? ''
  if (modo !== 'nuevo') {
    const valido = !!ref && !!hiloRef && validar.idGmail(ref) && validar.idGmail(hiloRef)
    // El hilo del original tiene que ser uno que la persona ve, y el mensaje, de ese hilo.
    const r = valido
      ? await ctx.autorizador
          .autorizarHilo(jwt, accountId, hiloRef!)
          .then(() => original(ctx, cuenta.buzon, { modo, ref_message_id: ref, thread_id: hiloRef } as EntradaRedaccion))
          .catch(() => null)
      : null
    if (r) texto = separarCita(texto, cita(modo, r.original)).propio
    else if (origen !== 'cabecera') {
      // Una inferencia que no se valida no se usa: se retoma como mail nuevo.
      modo = 'nuevo'
      ref = null
      hiloRef = null
      origen = 'sin_datos'
    }
  }
  return {
    draft_id: b.id,
    thread_id: modo === 'nuevo' ? hiloBorrador : hiloRef,
    modo,
    modo_origen: origen,
    ref_message_id: modo === 'nuevo' ? null : ref,
    para: direcciones(cabecera(m, 'To')),
    cc: direcciones(cabecera(m, 'Cc')),
    cco: direcciones(cabecera(m, 'Bcc')),
    asunto: payload.asunto,
    texto: texto.replace(/\r\n/g, '\n'),
    adjuntos: partesVisibles(m),
  }
}

export async function listarBorradores(ctx: ContextoRedactar, jwt: string, accountId: string, threadId: string | null) {
  const cuenta = await ctx.autorizador.autorizarCuenta(jwt, accountId)
  if (!ctx.buzones.has(cuenta.buzon.trim().toLowerCase())) throw new NoEncontrado('allowlist')
  if (threadId) await ctx.autorizador.autorizarHilo(jwt, accountId, threadId)
  const todos = await ctx.gmail.listarBorradores(cuenta.buzon)
  const elegidos = (threadId ? todos.filter((d) => d.threadId === threadId) : todos).slice(0, 25)
  const salida = []
  for (const d of elegidos) {
    const cab = await ctx.gmail.mensajeCabeceras(cuenta.buzon, d.messageId, ['To', 'Subject', 'Date', 'X-BT-Compose', 'In-Reply-To'])
    const modoCabecera = /modo=(responder_todos|responder|reenviar|nuevo)/.exec(cab.cabeceras['x-bt-compose'] ?? '')?.[1] ?? null
    const esRespuesta = !modoCabecera && !!(cab.cabeceras['in-reply-to'] ?? '').trim()
    salida.push({
      draft_id: d.id,
      thread_id: d.threadId,
      asunto: cab.cabeceras['subject'] ?? '',
      para: direcciones(cab.cabeceras['to'] ?? ''),
      fecha: cab.cabeceras['date'] ?? null,
      modo: modoCabecera ?? (esRespuesta ? 'responder' : null),
      modo_origen: modoCabecera ? 'cabecera' : esRespuesta ? 'in_reply_to' : 'sin_datos',
    })
  }
  return { borradores: salida }
}

export async function descartarBorrador(ctx: ContextoRedactar, jwt: string, accountId: string, draftId: string) {
  if (!ID_BORRADOR.test(draftId)) throw new NoEncontrado('draft_id')
  const cuenta = await ctx.autorizador.autorizarCuenta(jwt, accountId)
  if (!ctx.buzones.has(cuenta.buzon.trim().toLowerCase())) throw new NoEncontrado('allowlist')
  let threadId: string | null = null
  try {
    const b = await ctx.gmail.obtenerBorrador(cuenta.buzon, draftId)
    threadId = threadIdDe(b.message)
    await ctx.gmail.borrarBorrador(cuenta.buzon, draftId)
  } catch (err) {
    // Ya no existe: descartar algo que no está es un éxito, no un error.
    if (err instanceof ErrorGmail && err.status === 404) return { descartado: true, existia: false }
    throw err
  }
  await ctx.registro.descartarBorrador(jwt, cuenta.usuario, accountId, threadId)
  return { descartado: true, existia: true }
}

// ── Envío ──────────────────────────────────────────────────────────────────

/**
 * Por qué un envío sigue incierto:
 *   resultado_perdido    Gmail pudo haberlo aceptado; todavía no se buscó
 *   sin_coincidencia     se buscó en SENT y no hay ningún mensaje con este request id
 *   conflicto            hay MÁS DE UNO: no se elige ninguno, queda registrado
 *   busqueda_incompleta  la ventana tenía más mensajes que el tope revisado
 *   busqueda_fallida     Gmail no respondió la búsqueda
 */
export type MotivoIncierto = 'resultado_perdido' | 'sin_coincidencia' | 'conflicto' | 'busqueda_incompleta' | 'busqueda_fallida'

export type ResultadoEnvio =
  | { estado: 'enviado'; gmail_message_id: string; gmail_thread_id: string; repetido: boolean }
  | { estado: 'en_curso' }
  | { estado: 'incierto'; motivo: MotivoIncierto }
  | { estado: 'fallido'; error: string }

type Reconciliacion =
  | { tipo: 'unico'; id: string; threadId: string }
  | { tipo: 'incierto'; motivo: Exclude<MotivoIncierto, 'resultado_perdido'>; coincidencias: number }

/**
 * Busca en SENT, alrededor del último intento, el mensaje con este request id.
 *
 * Sólo cierra con UNA coincidencia exacta de la cabecera propia. Con 0, con más
 * de una, o sin poder revisar toda la ventana, NO decide: queda incierto. No hay
 * heurística de hilo + destinatario + hora: eso no prueba que sea este envío.
 */
async function reconciliar(ctx: ContextoRedactar, buzon: string, requestId: string, intentadoEn: string): Promise<Reconciliacion> {
  const centro = Date.parse(intentadoEn)
  let b
  try {
    b = await ctx.gmail.buscarEnviadosPorRequestId(buzon, requestId, centro - LIMITES.reconciliarAntesMs, centro + LIMITES.reconciliarDespuesMs)
  } catch {
    return { tipo: 'incierto', motivo: 'busqueda_fallida', coincidencias: 0 }
  }
  const unicos = [...new Map(b.coincidencias.map((m) => [m.id, m])).values()]
  if (unicos.length > 1) return { tipo: 'incierto', motivo: 'conflicto', coincidencias: unicos.length }
  if (!b.completa) return { tipo: 'incierto', motivo: 'busqueda_incompleta', coincidencias: unicos.length }
  const m = unicos[0]
  if (!m) return { tipo: 'incierto', motivo: 'sin_coincidencia', coincidencias: 0 }
  return { tipo: 'unico', id: m.id, threadId: m.threadId }
}

export async function enviar(
  ctx: ContextoRedactar,
  jwt: string,
  crudo: unknown,
  ahora: () => number = Date.now,
): Promise<ResultadoEnvio> {
  const c = (crudo ?? {}) as Record<string, unknown>
  const crid = typeof c['client_request_id'] === 'string' ? c['client_request_id'] : null
  if (!validar.uuid(crid)) throw new DatosInvalidos('client_request_id')
  const e = leerEntrada(crudo, true)

  // Autorización ANTES de reservar: un vendedor no deja ni una fila.
  const a = await autorizar(ctx, jwt, e)
  const reserva = await ctx.registro.reservar(jwt, a.usuario, a.accountId, crid, e.modo)

  if (!reserva.nuevo) {
    if (reserva.status === 'enviado') {
      return { estado: 'enviado', gmail_message_id: reserva.gmailMessageId!, gmail_thread_id: reserva.gmailThreadId!, repetido: true }
    }
    const vencida = ahora() - Date.parse(reserva.intentadoEn) > LIMITES.reservaVencidaMs
    if (reserva.status === 'reservado' && !vencida) return { estado: 'en_curso' }
    // incierto, o una reserva abandonada: se busca en SENT por X-BT-Request-Id. NUNCA se reenvía.
    const r = await reconciliar(ctx, a.buzon, crid, reserva.intentadoEn)
    if (r.tipo === 'unico') {
      await ctx.registro.completar(jwt, a.usuario, reserva.id, 'enviado', r.id, r.threadId, null)
      return { estado: 'enviado', gmail_message_id: r.id, gmail_thread_id: r.threadId, repetido: true }
    }
    // El conflicto queda registrado en la fila; lo demás sólo si la reserva estaba abandonada.
    const codigo = r.motivo === 'conflicto' ? `conflicto_request_id:${r.coincidencias}` : reserva.status === 'reservado' ? 'reserva_vencida' : null
    if (codigo) await ctx.registro.completar(jwt, a.usuario, reserva.id, 'incierto', null, null, codigo).catch(() => undefined)
    return { estado: 'incierto', motivo: r.motivo }
  }

  // Desde acá, este request es el único dueño del envío.
  let p: Preparado
  try {
    p = await preparar(ctx, jwt, e, { borrador: false, requestId: crid })
    if (e.draft_id) {
      // El borrador se reemplaza por la versión final (sin X-BT-Compose). Es
      // idempotente: si falla, el mail todavía no salió.
      await ctx.gmail.actualizarBorrador(p.buzon, e.draft_id, p.raw, p.threadId)
    }
  } catch (err) {
    await ctx.registro.completar(jwt, a.usuario, reserva.id, 'fallido', null, null, codigoError(err)).catch(() => undefined)
    throw err
  }

  try {
    const r = e.draft_id
      ? await ctx.gmail.enviarBorrador(p.buzon, e.draft_id)
      : await ctx.gmail.enviarMensaje(p.buzon, p.raw, p.threadId)
    try {
      await ctx.registro.completar(jwt, a.usuario, reserva.id, 'enviado', r.id, r.threadId, null)
    } catch {
      // Gmail YA lo mandó. Si la base no respondió, la fila queda reservada y el
      // siguiente reintento la reconcilia por Message-ID. Nunca se reenvía.
    }
    return { estado: 'enviado', gmail_message_id: r.id, gmail_thread_id: r.threadId, repetido: false }
  } catch (err) {
    if (err instanceof ResultadoIncierto) {
      await ctx.registro.completar(jwt, a.usuario, reserva.id, 'incierto', null, null, err.causa).catch(() => undefined)
      return { estado: 'incierto', motivo: 'resultado_perdido' }
    }
    // 4xx definitivo o 429 agotado: Gmail no lo aceptó.
    await ctx.registro.completar(jwt, a.usuario, reserva.id, 'fallido', null, null, codigoError(err)).catch(() => undefined)
    if (err instanceof ErrorGmail && err.status !== 429 && err.status !== 401 && err.status !== 403) {
      return { estado: 'fallido', error: 'gmail_rechazo' }
    }
    throw err
  }
}

function codigoError(err: unknown): string {
  if (err instanceof DatosInvalidos) return err.message.slice(0, 60)
  if (err instanceof MimeInvalido) return `mime:${err.message}`.slice(0, 60)
  if (err instanceof ErrorGmail) return `gmail_${err.status}`
  if (err instanceof NoEncontrado) return 'no_encontrado'
  return (err as Error)?.name?.slice(0, 60) || 'error'
}
