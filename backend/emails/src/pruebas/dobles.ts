/**
 * Dobles de prueba: un Gmail falso y un almacén en memoria.
 *
 * Existen para que el algoritmo de sincronización se pruebe entero —incluidos
 * el 404 de historial, los eventos fuera de orden, el lease y el resync— **sin
 * tocar `info@buscatools.com.ar` ni una sola vez**.
 *
 * Ningún dato de acá sale de correo real: los hilos son inventados.
 */
import type {
  BusquedaEnviados,
  CabecerasMensaje,
  ClienteGmail,
  Enviado,
  HiloGmail,
  PaginaHilos,
  PaginaHistorial,
  RespuestaWatch,
  ResumenBorrador,
} from '../google/gmail.js'
import { ResultadoIncierto } from '../google/reintentos.js'
import { cabecera, leerMime } from './mimeLector.js'
import type { EstadoEnvio, Operacion, Reserva, RegistroEnvios } from '../api/registro.js'
import { LimiteEnvios } from '../api/registro.js'
import { NoEncontrado } from '../api/autorizacion.js'
import { ErrorGmail, HistorialVencido } from '../google/gmail.js'
import type { Almacen, CuentaEmail, EntradaSync, FilaHilo } from '../almacen.js'

export interface HiloFalso {
  id: string
  historyId: string
  asunto: string
  de: string
  para: string
  cuando: number
  etiquetas?: string[]
  adjuntos?: boolean
}

export function hilo(h: HiloFalso): HiloGmail {
  return {
    id: h.id,
    historyId: h.historyId,
    mensajes: [
      {
        id: `${h.id}-m1`,
        threadId: h.id,
        labelIds: h.etiquetas ?? ['INBOX'],
        snippet: `extracto de ${h.asunto}`,
        internalDate: String(h.cuando),
        sizeEstimate: 2048,
        headers: { from: h.de, to: h.para, subject: h.asunto },
        tieneAdjuntos: h.adjuntos ?? false,
      },
    ],
  }
}

export class GmailFalso implements ClienteGmail {
  /** Historial: historyId → ids de hilo tocados. */
  readonly historial = new Map<string, string[]>()
  readonly hilos = new Map<string, HiloGmail>()
  historyIdActual = '1000'
  /** Si se prende, `listarHistorial` tira HistorialVencido. */
  vencerHistorial = false
  readonly llamadas: string[] = []

  agregar(h: HiloGmail, enHistoryId: string): void {
    this.hilos.set(h.id, h)
    const previos = this.historial.get(enHistoryId) ?? []
    this.historial.set(enHistoryId, [...previos, h.id])
    if (BigInt(enHistoryId) > BigInt(this.historyIdActual)) this.historyIdActual = enHistoryId
  }

  async perfil(buzon: string) {
    this.llamadas.push('perfil')
    return { emailAddress: buzon, historyId: this.historyIdActual, messagesTotal: this.hilos.size }
  }

  async listarHistorial(_buzon: string, desde: string): Promise<PaginaHistorial> {
    this.llamadas.push(`historial:${desde}`)
    if (this.vencerHistorial) throw new HistorialVencido(desde)
    const tocados = new Set<string>()
    for (const [hid, ids] of this.historial) {
      if (BigInt(hid) > BigInt(desde)) for (const id of ids) tocados.add(id)
    }
    return { hilosTocados: [...tocados], historyId: this.historyIdActual, siguientePagina: null }
  }

  async listarHilos(_buzon?: string, _pagina?: string, consulta?: string): Promise<PaginaHilos> {
    this.llamadas.push(`listarHilos${consulta ? ':' + consulta : ''}`)
    return { hilos: [...this.hilos.keys()], siguientePagina: null }
  }

  async hiloMetadata(_buzon: string, id: string): Promise<HiloGmail | null> {
    this.llamadas.push(`hilo:${id}`)
    return this.hilos.get(id) ?? null
  }

  /** Ids que el falso reporta como «con adjunto». La suite los fija. */
  conAdjunto = new Set<string>()

  async hilosConAdjunto(_buzon: string, consulta: string): Promise<Set<string>> {
    this.llamadas.push(`conAdjunto:${consulta}`)
    return new Set(this.conAdjunto)
  }

  async hiloCompleto(_buzon: string, id: string): Promise<unknown> {
    this.llamadas.push(`hiloCompleto:${id}`)
    const h = this.hilosCompletos.get(id)
    if (h) return h
    const indice = this.hilos.get(id)
    if (!indice) throw new ErrorGmail(404, 'no existe')
    return indice
  }

  /** Mensajes con partes, para las rutas de la bandeja. La suite los fija. */
  readonly mensajesCompletos = new Map<string, unknown>()
  readonly hilosCompletos = new Map<string, unknown>()
  readonly adjuntos = new Map<string, string>()

  async mensajeCompleto(_buzon: string, id: string): Promise<unknown> {
    this.llamadas.push(`mensajeCompleto:${id}`)
    const m = this.mensajesCompletos.get(id)
    if (!m) throw new ErrorGmail(404, 'no existe')
    return m
  }

  async adjunto(_buzon?: string, mensajeId?: string, adjuntoId?: string): Promise<{ data: string; size: number }> {
    this.llamadas.push(`adjunto:${mensajeId ?? ''}:${adjuntoId ?? ''}`)
    const data = this.adjuntos.get(adjuntoId ?? '')
    if (data !== undefined) return { data, size: Buffer.from(data, 'base64url').length }
    return { data: '', size: 0 }
  }

  async iniciarWatch(): Promise<RespuestaWatch> {
    this.llamadas.push('watch')
    return {
      historyId: this.historyIdActual,
      expiration: String(Date.now() + 7 * 24 * 3600 * 1000),
    }
  }

  // ── Entrega 5: borradores y envío ───────────────────────────────────────
  private secuencia = 0
  readonly borradores = new Map<string, { raw: Buffer; messageId: string; threadId: string }>()
  readonly enviados: Array<{ id: string; threadId: string; raw: Buffer; fecha: number }> = []
  /**
   * Como Gmail real (medido en producción el 13/9): el Message-ID que manda el
   * cliente se REEMPLAZA por uno propio al guardar un envío o un borrador.
   */
  reemplazaMessageId = true
  /** Si Gmail conserva las cabeceras X-BT-*. Todavía no medido en real: las pruebas cubren ambos casos. */
  conservaCabecerasPropias = true
  /** Reloj de los envíos (internalDate). */
  reloj: () => number = Date.now
  /** La búsqueda en SENT falla (Gmail no responde) o no llega a revisar toda la ventana. */
  falloBusqueda = false
  busquedaIncompleta = false
  /** Cuántas veces se llamó a cada método que manda o crea algo. */
  readonly conteo = { crearBorrador: 0, actualizarBorrador: 0, borrarBorrador: 0, enviarBorrador: 0, enviarMensaje: 0 }
  /**
   * Falla inyectada en el próximo envío:
   *   aceptado_incierto  Gmail lo manda pero la respuesta se pierde (timeout)
   *   incierto_sin_envio el pedido se corta antes de que Gmail lo procese
   *   429 / 400          Gmail no lo acepta
   */
  falloEnvio: null | 'aceptado_incierto' | 'incierto_sin_envio' | '429' | '400' = null
  /** Demora de cada envío, para que las carreras sean reales. */
  demoraEnvioMs = 0

  private nuevoId(prefijo: string): string {
    this.secuencia++
    return `${prefijo}${this.secuencia.toString(16).padStart(12, '0')}`
  }

  /** Lo que Gmail guarda en lugar de lo que recibió. */
  private comoGuardaGmail(raw: Buffer): Buffer {
    const texto = raw.toString('latin1')
    const corte = texto.indexOf('\r\n\r\n')
    let cab = texto.slice(0, corte + 2)
    const resto = texto.slice(corte + 2)
    const quitar = (patron: RegExp) => { cab = cab.replace(patron, '') }
    if (this.reemplazaMessageId) {
      quitar(/^Message-ID:.*\r\n(?:[ \t].*\r\n)*/gim)
      cab += `Message-Id: <CAFAKE${this.nuevoId('m')}@mail.gmail.com>\r\n`
    }
    if (!this.conservaCabecerasPropias) quitar(/^X-BT-[^:]*:.*\r\n(?:[ \t].*\r\n)*/gim)
    return Buffer.from(cab + resto, 'latin1')
  }

  private mensajeDeRaw(id: string, threadId: string, raw: Buffer, etiquetas: string[]): unknown {
    const { payload } = leerMime(raw, (partId, bytes) => {
      const att = `att${id}p${partId.split('.').join('x')}`
      this.adjuntos.set(att, bytes.toString('base64url'))
      return att
    })
    return { id, threadId, labelIds: etiquetas, internalDate: String(Date.now()), payload }
  }

  async mensajeCabeceras(_buzon: string, mensajeId: string, nombres: string[]): Promise<CabecerasMensaje> {
    this.llamadas.push(`cabeceras:${mensajeId}`)
    const completo = this.mensajesCompletos.get(mensajeId) as
      | { id: string; threadId: string; labelIds?: string[]; payload?: { headers?: Array<{ name: string; value: string }> } }
      | undefined
    let headers: Array<{ name: string; value: string }> = completo?.payload?.headers ?? []
    let threadId = completo?.threadId ?? ''
    if (!completo) {
      const env = this.enviados.find((e) => e.id === mensajeId)
      const bor = [...this.borradores.values()].find((b) => b.messageId === mensajeId)
      const raw = env?.raw ?? bor?.raw
      if (!raw) throw new ErrorGmail(404, 'no existe')
      threadId = env?.threadId ?? bor!.threadId
      headers = leerMime(raw, () => 'x').headers
    }
    const cab: Record<string, string> = {}
    for (const n of nombres) {
      const v = headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value
      if (v !== undefined) cab[n.toLowerCase()] = v
    }
    return { id: mensajeId, threadId, labelIds: completo?.labelIds ?? [], cabeceras: cab }
  }

  async listarBorradores(): Promise<ResumenBorrador[]> {
    this.llamadas.push('listarBorradores')
    return [...this.borradores.entries()].map(([id, b]) => ({ id, messageId: b.messageId, threadId: b.threadId }))
  }

  async obtenerBorrador(_buzon: string, borradorId: string): Promise<{ id: string; message: unknown }> {
    this.llamadas.push(`obtenerBorrador:${borradorId}`)
    const b = this.borradores.get(borradorId)
    if (!b) throw new ErrorGmail(404, 'no existe')
    return { id: borradorId, message: this.mensajeDeRaw(b.messageId, b.threadId, b.raw, ['DRAFT']) }
  }

  async crearBorrador(_buzon: string, raw: Buffer, threadId: string | null): Promise<ResumenBorrador> {
    this.conteo.crearBorrador++
    const id = this.nuevoId('r')
    const messageId = this.nuevoId('d')
    const hilo = threadId ?? this.nuevoId('f')
    this.borradores.set(id, { raw: this.comoGuardaGmail(raw), messageId, threadId: hilo })
    return { id, messageId, threadId: hilo }
  }

  async actualizarBorrador(_buzon: string, borradorId: string, raw: Buffer, threadId: string | null): Promise<ResumenBorrador> {
    this.conteo.actualizarBorrador++
    if (!this.borradores.has(borradorId)) throw new ErrorGmail(404, 'no existe')
    await new Promise((r) => setTimeout(r, 1))
    const previo = this.borradores.get(borradorId)
    if (!previo) throw new ErrorGmail(404, 'no existe')
    const messageId = this.nuevoId('d')
    const hilo = threadId ?? previo.threadId
    this.borradores.set(borradorId, { raw: this.comoGuardaGmail(raw), messageId, threadId: hilo })
    return { id: borradorId, messageId, threadId: hilo }
  }

  async borrarBorrador(_buzon: string, borradorId: string): Promise<void> {
    this.conteo.borrarBorrador++
    if (!this.borradores.delete(borradorId)) throw new ErrorGmail(404, 'no existe')
  }

  private async aplicarEnvio(raw: Buffer, threadId: string): Promise<Enviado> {
    if (this.demoraEnvioMs) await new Promise((r) => setTimeout(r, this.demoraEnvioMs))
    const fallo = this.falloEnvio
    this.falloEnvio = null
    if (fallo === '429') throw new ErrorGmail(429, 'rateLimitExceeded')
    if (fallo === '400') throw new ErrorGmail(400, 'invalid')
    if (fallo === 'incierto_sin_envio') throw new ResultadoIncierto('HTTP 503')
    const enviado = { id: this.nuevoId('e'), threadId, raw: this.comoGuardaGmail(raw), fecha: this.reloj() }
    this.enviados.push(enviado)
    if (fallo === 'aceptado_incierto') throw new ResultadoIncierto('TimeoutError')
    return { id: enviado.id, threadId }
  }

  async enviarBorrador(_buzon: string, borradorId: string): Promise<Enviado> {
    this.conteo.enviarBorrador++
    const b = this.borradores.get(borradorId)
    if (!b) throw new ErrorGmail(404, 'no existe')
    this.borradores.delete(borradorId)
    return this.aplicarEnvio(b.raw, b.threadId)
  }

  async enviarMensaje(_buzon: string, raw: Buffer, threadId: string | null): Promise<Enviado> {
    this.conteo.enviarMensaje++
    return this.aplicarEnvio(raw, threadId ?? this.nuevoId('n'))
  }

  async buscarEnviadosPorRequestId(_buzon: string, requestId: string, desdeMs: number, hastaMs: number): Promise<BusquedaEnviados> {
    this.llamadas.push('buscarEnviadosPorRequestId')
    if (this.falloBusqueda) throw new ErrorGmail(503, 'backendError')
    const ventana = this.enviados.filter((e) => e.fecha >= desdeMs && e.fecha <= hastaMs)
    const coincidencias = ventana
      .filter((e) => (cabecera(e.raw, 'X-BT-Request-Id') ?? '').trim() === requestId)
      .map((e) => ({ id: e.id, threadId: e.threadId }))
    return { coincidencias, revisados: ventana.length, completa: !this.busquedaIncompleta }
  }

  /** Un segundo mensaje en SENT con las MISMAS cabeceras (p. ej. alguien lo reenvió desde Gmail). */
  duplicarEnviado(id: string): void {
    const e = this.enviados.find((x) => x.id === id)
    if (!e) throw new Error('no existe')
    this.enviados.push({ ...e, id: this.nuevoId('e') })
  }
}

// ── Registro de envíos en memoria, con la semántica de las RPC ──────────────

interface FilaEnvio {
  id: string
  accountId: string
  usuario: string
  crid: string
  operacion: Operacion
  status: EstadoEnvio
  messageId: string | null
  threadId: string | null
  creadoEn: string
  intentadoEn: string
  intentos: number
  error: string | null
}

export class RegistroMemoria implements RegistroEnvios {
  readonly filas = new Map<string, FilaEnvio>()
  readonly eventos: Array<{ accion: string; threadId: string | null; messageId?: string | null }> = []
  limitePorUsuario = 30

  async reservar(_jwt: string, usuario: string, accountId: string, crid: string, operacion: Operacion): Promise<Reserva> {
    // Sin await entre leer y escribir: atómico, como el INSERT ... ON CONFLICT.
    const clave = `${accountId}|${crid}`
    const f = this.filas.get(clave)
    if (!f) {
      const recientes = [...this.filas.values()].filter((x) => x.usuario === usuario && x.status !== 'fallido').length
      if (recientes >= this.limitePorUsuario) throw new LimiteEnvios('usuario')
      const nueva: FilaEnvio = {
        id: `req-${this.filas.size + 1}`, accountId, usuario, crid, operacion, status: 'reservado',
        messageId: null, threadId: null, creadoEn: new Date().toISOString(), intentadoEn: new Date().toISOString(), intentos: 1, error: null,
      }
      this.filas.set(clave, nueva)
      return this.aReserva(nueva, true)
    }
    if (f.usuario !== usuario) throw new NoEncontrado('solicitud_de_otro_usuario')
    if (f.status === 'fallido') {
      f.status = 'reservado'
      f.intentos++
      f.intentadoEn = new Date().toISOString()
      return this.aReserva(f, true)
    }
    return this.aReserva(f, false)
  }

  private aReserva(f: FilaEnvio, nuevo: boolean): Reserva {
    return { id: f.id, status: f.status, nuevo, gmailMessageId: f.messageId, gmailThreadId: f.threadId, creadoEn: f.creadoEn, intentadoEn: f.intentadoEn, intentos: f.intentos }
  }

  async completar(
    _jwt: string, usuario: string, requestId: string, estado: Exclude<EstadoEnvio, 'reservado'>,
    messageId: string | null, threadId: string | null, error: string | null,
  ): Promise<void> {
    const f = [...this.filas.values()].find((x) => x.id === requestId && x.usuario === usuario)
    if (!f) throw new NoEncontrado('solicitud_inexistente')
    const valida =
      (f.status === 'reservado' && ['enviado', 'fallido', 'incierto'].includes(estado)) ||
      (f.status === 'incierto' && ['enviado', 'incierto'].includes(estado))
    if (!valida) throw new Error('transicion_invalida')
    f.status = estado
    f.error = error
    if (estado === 'enviado') {
      f.messageId = messageId
      f.threadId = threadId
      const accion = { nuevo: 'email_enviado', responder: 'respuesta_enviada', responder_todos: 'respuesta_a_todos_enviada', reenviar: 'reenvio_enviado' }[f.operacion]
      this.eventos.push({ accion, threadId, messageId })
    }
  }

  async descartarBorrador(_jwt: string, _usuario: string, _accountId: string, threadId: string | null): Promise<void> {
    this.eventos.push({ accion: 'borrador_descartado', threadId })
  }

  /** Simula una reserva abandonada por un proceso que murió. */
  envejecer(ms: number): void {
    for (const f of this.filas.values()) {
      f.creadoEn = new Date(Date.parse(f.creadoEn) - ms).toISOString()
      f.intentadoEn = new Date(Date.parse(f.intentadoEn) - ms).toISOString()
    }
  }
}

export class AlmacenMemoria implements Almacen {
  readonly cuentas = new Map<string, CuentaEmail>()
  readonly hilos = new Map<string, FilaHilo>()
  /** Simula email_thread_state: la suite comprueba que NUNCA se toque. */
  readonly estados = new Map<string, { workflow_status: string; assigned_to: string | null }>()
  readonly logs: EntradaSync[] = []
  readonly errores: string[] = []

  constructor(cuenta: CuentaEmail) {
    this.cuentas.set(cuenta.id, { ...cuenta })
  }

  private clave(f: { account_id: string; gmail_thread_id: string }): string {
    return `${f.account_id}|${f.gmail_thread_id}`
  }

  async cuentaPorDireccion(d: string): Promise<CuentaEmail | null> {
    for (const c of this.cuentas.values()) if (c.email_address === d && c.active) return { ...c }
    return null
  }

  async cuentaPorId(id: string): Promise<CuentaEmail | null> {
    const c = this.cuentas.get(id)
    return c ? { ...c } : null
  }

  async cuentasActivas(): Promise<CuentaEmail[]> {
    return [...this.cuentas.values()].filter((c) => c.active).map((c) => ({ ...c }))
  }

  async tomarLease(id: string, dueno: string): Promise<CuentaEmail | null> {
    const c = this.cuentas.get(id)
    if (!c || !c.active) return null
    const tomado = c.sync_lock_until && new Date(c.sync_lock_until).getTime() > Date.now()
    if (tomado) return null
    c.sync_lock_until = new Date(Date.now() + 5 * 60_000).toISOString()
    c.sync_lock_owner = dueno
    return { ...c }
  }

  async soltarLease(id: string, dueno: string): Promise<void> {
    const c = this.cuentas.get(id)
    if (c && c.sync_lock_owner === dueno) {
      c.sync_lock_until = null
      c.sync_lock_owner = null
    }
  }

  async avanzarHistory(id: string, historyId: string, full: boolean): Promise<void> {
    const c = this.cuentas.get(id)
    if (!c) return
    // Igual que la RPC: comparación numérica, y nunca hacia atrás.
    if (c.last_history_id === null || BigInt(historyId) > BigInt(c.last_history_id)) {
      c.last_history_id = historyId
    }
    if (full) c.watch_expiration = c.watch_expiration ?? null
  }

  async upsertHilos(filas: FilaHilo[]): Promise<void> {
    for (const f of filas) this.hilos.set(this.clave(f), { ...f })
  }

  async registrarSync(e: EntradaSync): Promise<void> {
    this.logs.push(e)
  }

  async guardarWatch(id: string, expiration: string, _topic?: string): Promise<void> {
    const c = this.cuentas.get(id)
    if (!c) return
    c.watch_expiration = new Date(Number(expiration)).toISOString()
  }

  async registrarError(_id: string, error: string): Promise<void> {
    this.errores.push(error)
  }
}

export function cuentaDePrueba(sobreescribir: Partial<CuentaEmail> = {}): CuentaEmail {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    company_id: '22222222-2222-2222-2222-222222222222',
    email_address: 'buzon@prueba.invalid',
    provider: 'gmail',
    auth_mode: 'dwd',
    active: true,
    last_history_id: '1000',
    watch_expiration: null,
    sync_lock_until: null,
    sync_lock_owner: null,
    ...sobreescribir,
  }
}
