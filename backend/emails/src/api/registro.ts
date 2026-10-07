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
import { createHash, createHmac } from 'node:crypto'
import { ClaveDesalineada, IndiceNoDisponible, NoAutenticado, NoEncontrado } from './autorizacion.js'

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
  /**
   * ¿Este servicio y la base comparten la clave?
   *
   * `null` cuando no se pudo averiguar (la base no contestó, o es una versión
   * sin la función). «No sé» no es «está mal»: no se alarma por una red lenta.
   */
  claveCoincide(): Promise<boolean | null>
  /**
   * El envoltorio de la empresa, ya resuelto para quien manda. `null` si no hay
   * ninguno configurado o si no se pudo leer.
   */
  envoltorio(jwt: string, companyId: string): Promise<string | null>
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
    // La base dice que la firma no le cierra: este servicio y ella tienen claves
    // distintas. Tiene su propio error —no es la base caída— porque confundirlo
    // con una indisponibilidad manda a buscar donde no es. Ver `ClaveDesalineada`.
    if (mensaje === 'firma_invalida') throw new ClaveDesalineada(`PostgREST ${r.status} firma_invalida`)
    // transicion_invalida u otro: es un error del servicio, no del usuario.
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

  /**
   * El envoltorio de la empresa, resuelto para quien manda.
   *
   * Se pide con el JWT de la persona, así la base aplica su RLS y rellena los
   * marcadores con SU ficha: dos personas piden lo mismo y reciben distinto.
   *
   * Si falla, falla: el que decide que un envío no se cae por una plantilla es
   * QUIEN LLAMA, en `redactar.ts`. Tragarse el error acá adentro dejaba esa
   * garantía dependiendo de la implementación —otra que tirara excepción
   * tumbaba el envío— y además hacía imposible distinguir «no hay envoltorio»
   * de «no se pudo leer».
   */
  async envoltorio(jwt: string, companyId: string): Promise<string | null> {
    const filas = (await this.rpc(jwt, 'plantillas_para_enviar', { p_company: companyId })) as
      | Array<{ envoltorio: string | null }>
      | null
    const e = filas?.[0]?.envoltorio ?? null
    // Un envoltorio sin el hueco no envuelve nada: se trataría como si no
    // hubiera. La pantalla no deja guardarlo así, pero esto no se fía de eso.
    return e && e.includes('{{cuerpo}}') ? e : null
  }

  /**
   * Compara la clave con la de la base, sin que ninguna de las dos viaje.
   *
   * Va la HUELLA —16 hexadecimales del sha256— y la base contesta sí o no. La
   * llamada es con la clave publicable, como `anon`, porque esto corre al
   * ARRANCAR el servicio, cuando todavía no hay ninguna persona logueada: es
   * justo el momento en que sirve enterarse.
   *
   * Existe por los 22 días de octubre de 2026 en los que no se pudo mandar un
   * solo mail y nadie lo supo: la migración de la base a São Paulo generó una
   * clave nueva —la genera ella, con `gen_random_bytes`— y el servicio siguió
   * con la vieja. El primero en enterarse fue un usuario, tres semanas después.
   */
  async claveCoincide(): Promise<boolean | null> {
    const huella = createHash('sha256').update(this.clave).digest('hex').slice(0, 16)
    try {
      const r = await this.pedir(`${this.url}/rest/v1/rpc/clave_api_email_coincide`, {
        method: 'POST',
        headers: {
          apikey: this.clavePublica,
          Authorization: `Bearer ${this.clavePublica}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_huella: huella }),
      })
      if (!r.ok) return null
      return (await r.json()) === true
    } catch {
      return null
    }
  }
}
