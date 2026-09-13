/**
 * El registro de idempotencia de envíos, en Supabase.
 *
 * Las RPC se llaman con el JWT de la persona —así la base sabe quién es y aplica
 * sus permisos— y además con una firma HMAC-SHA256 que sólo este servicio puede
 * producir. Sin la firma, el navegador con ese mismo JWT no puede marcar un
 * envío como hecho ni fabricar un evento de envío. Ver
 * `docs/database/PHASE_9_EMAILS_ENTREGA_5.sql`.
 *
 * El formato de cada mensaje firmado tiene que coincidir, carácter por carácter,
 * con el que arma la RPC.
 */
import { createHmac } from 'node:crypto'
import { IndiceNoDisponible, NoAutenticado, NoEncontrado } from './autorizacion.js'

export type EstadoEnvio = 'reservado' | 'enviado' | 'fallido' | 'incierto'
export type Operacion = 'nuevo' | 'responder' | 'responder_todos' | 'reenviar'

export interface Reserva {
  id: string
  status: EstadoEnvio
  nuevo: boolean
  gmailMessageId: string | null
  gmailThreadId: string | null
  creadoEn: string
  /** El último intento (reserva o re-reserva de un fallido): centro de la ventana de reconciliación. */
  intentadoEn: string
  intentos: number
}

export class LimiteEnvios extends Error {
  constructor(readonly alcance: 'usuario' | 'cuenta') {
    super(`limite_envios_${alcance}`)
    this.name = 'LimiteEnvios'
  }
}

export interface RegistroEnvios {
  reservar(jwt: string, usuario: string, accountId: string, clientRequestId: string, operacion: Operacion): Promise<Reserva>
  completar(
    jwt: string,
    usuario: string,
    requestId: string,
    estado: Exclude<EstadoEnvio, 'reservado'>,
    messageId: string | null,
    threadId: string | null,
    error: string | null,
  ): Promise<void>
  descartarBorrador(jwt: string, usuario: string, accountId: string, threadId: string | null): Promise<void>
}

export function firmar(clave: Buffer, mensaje: string): string {
  return createHmac('sha256', clave).update(mensaje, 'utf8').digest('hex')
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export class RegistroSupabase implements RegistroEnvios {
  constructor(
    private readonly url: string,
    private readonly clavePublica: string,
    private readonly clave: Buffer,
    private readonly pedir: Fetch = fetch,
  ) {
    if (clave.length < 32) throw new Error('EMAIL_API_HMAC demasiado corta')
  }

  private async rpc(jwt: string, nombre: string, cuerpo: Record<string, unknown>): Promise<unknown> {
    let r: Response
    try {
      r = await this.pedir(`${this.url}/rest/v1/rpc/${nombre}`, {
        method: 'POST',
        headers: { apikey: this.clavePublica, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      })
    } catch (e) {
      throw new IndiceNoDisponible((e as Error).message)
    }
    const txt = await r.text()
    if (r.ok) return txt ? JSON.parse(txt) : null
    if (r.status === 401) throw new NoAutenticado(`PostgREST ${r.status}`)
    const mensaje = (() => {
      try {
        return String((JSON.parse(txt) as { message?: unknown }).message ?? '')
      } catch {
        return ''
      }
    })()
    if (mensaje === 'limite_envios_usuario') throw new LimiteEnvios('usuario')
    if (mensaje === 'limite_envios_cuenta') throw new LimiteEnvios('cuenta')
    if (/sin_permiso|solicitud_de_otro_usuario|solicitud_inexistente/.test(mensaje)) throw new NoEncontrado(mensaje)
    // firma_invalida, transicion_invalida u otro: es un error del servicio, no del usuario.
    throw new IndiceNoDisponible(`PostgREST ${r.status} ${mensaje.slice(0, 60)}`)
  }

  async reservar(jwt: string, usuario: string, accountId: string, clientRequestId: string, operacion: Operacion): Promise<Reserva> {
    const firma = firmar(this.clave, `reservar|${accountId}|${clientRequestId}|${operacion}|${usuario}`)
    const filas = (await this.rpc(jwt, 'reservar_envio_email', {
      p_account: accountId,
      p_client_request_id: clientRequestId,
      p_operacion: operacion,
      p_firma: firma,
    })) as Array<{
      id: string
      status: EstadoEnvio
      nuevo: boolean
      gmail_message_id: string | null
      gmail_thread_id: string | null
      created_at: string
      intentos: number
      attempted_at?: string | null
    }>
    const f = filas[0]
    if (!f) throw new IndiceNoDisponible('reservar sin fila')
    return {
      id: f.id,
      status: f.status,
      nuevo: f.nuevo,
      gmailMessageId: f.gmail_message_id,
      gmailThreadId: f.gmail_thread_id,
      creadoEn: f.created_at,
      intentadoEn: f.attempted_at ?? f.created_at,
      intentos: f.intentos,
    }
  }

  async completar(
    jwt: string,
    usuario: string,
    requestId: string,
    estado: Exclude<EstadoEnvio, 'reservado'>,
    messageId: string | null,
    threadId: string | null,
    error: string | null,
  ): Promise<void> {
    const firma = firmar(
      this.clave,
      `completar|${requestId}|${estado}|${messageId ?? ''}|${threadId ?? ''}|${error ?? ''}|${usuario}`,
    )
    await this.rpc(jwt, 'completar_envio_email', {
      p_request: requestId,
      p_estado: estado,
      p_message_id: messageId,
      p_thread_id: threadId,
      p_error: error,
      p_firma: firma,
    })
  }

  async descartarBorrador(jwt: string, usuario: string, accountId: string, threadId: string | null): Promise<void> {
    const firma = firmar(this.clave, `descartar|${accountId}|${threadId ?? ''}|${usuario}`)
    await this.rpc(jwt, 'registrar_descarte_borrador_email', { p_account: accountId, p_thread: threadId, p_firma: firma })
  }
}
