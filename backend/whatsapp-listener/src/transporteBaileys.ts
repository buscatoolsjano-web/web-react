import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
} from 'baileys'
import { normalizarJid, normalizarMensaje, protocoloDe, type MensajeCrudo } from './normalizar.js'
import { ocultarId, sanearError, type Registro } from './registro.js'
import { registroParaBaileys } from './registroBaileys.js'
import type { Transporte } from './transporte.js'
import type { EstadoDeConexion, Evento } from './tipos.js'

/**
 * El transporte real: la ÚNICA pieza del listener que importa Baileys.
 *
 * Todo lo que la librería tiene de frágil queda de este lado —el protocolo que
 * cambia, la sesión que se cae, los tipos que se mueven entre release
 * candidates— y el resto del sistema sigue recibiendo `Evento`. Cuando haya
 * que actualizar la librería, o el día que exista una API oficial de grupos
 * que sirva, se toca este archivo y ningún otro.
 *
 * Tres opciones del socket que NO son el default y valen una explicación:
 *
 * - `syncFullHistory: false`. El default es `true` y bajaría **el historial
 *   entero de la cuenta**, incluidos los chats privados, apenas se vincula.
 *   Además de ser una montaña de datos, es exactamente lo que este sistema no
 *   tiene que leer. El evento `messaging-history.set` ni siquiera se escucha.
 * - `markOnlineOnConnect: false`. El default es `true` y **le corta las
 *   notificaciones push al teléfono**: WhatsApp deja de avisarle a Juan porque
 *   ya hay un cliente «en línea». Un listener no puede robarle las
 *   notificaciones a la persona.
 * - `logger` propio, que tira `debug` y `trace`. Ver `registroParaBaileys`.
 */
export interface OpcionesBaileys {
  /** Carpeta del estado de sesión. Fuera del repo y fuera del entorno. */
  rutaDeSesion: string
  registro: Registro
  /** Se llama con el QR cuando hay que vincular. El QR NO se loguea. */
  alPedirQr?: (qr: string) => void
}

export class TransporteBaileys implements Transporte {
  private socket: WASocket | null = null
  private escuchas: ((evento: Evento) => void | Promise<void>)[] = []
  private caidas: ((motivo: string) => void)[] = []
  private conexion: EstadoDeConexion = 'desconectado'
  private jidDeLaCuenta: string | null = null
  private detenido = false
  /** Nombre de cada grupo, para no pedir la metadata en cada mensaje. */
  private readonly nombres = new Map<string, string>()

  constructor(private readonly opciones: OpcionesBaileys) {}

  estado(): EstadoDeConexion {
    return this.conexion
  }

  /** El jid de la cuenta vinculada, ofuscado. Para el sanity check de arranque. */
  get cuenta(): string | null {
    return this.jidDeLaCuenta === null ? null : ocultarId(this.jidDeLaCuenta)
  }

  alRecibir(escucha: (evento: Evento) => void | Promise<void>): void {
    this.escuchas.push(escucha)
  }

  alCaerse(escucha: (motivo: string) => void): void {
    this.caidas.push(escucha)
  }

  /**
   * Abre la sesión y resuelve cuando quedó escuchando.
   *
   * Si no hay sesión guardada, resuelve igual —en `requiere_autenticacion`—
   * después de emitir el QR: el proceso tiene que quedar vivo y con el
   * healthcheck contestando mientras alguien va a buscar el teléfono.
   */
  async conectar(): Promise<void> {
    this.detenido = false
    const { state, saveCreds } = await useMultiFileAuthState(this.opciones.rutaDeSesion)
    const { version } = await fetchLatestBaileysVersion()
    this.opciones.registro.evento('info', 'baileys_version', { version: version.join('.') })

    const socket = makeWASocket({
      auth: state,
      version,
      logger: registroParaBaileys(this.opciones.registro),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      // No hay reenvíos: este cliente no manda mensajes, sólo escucha.
      getMessage: () => Promise.resolve(undefined),
    })
    this.socket = socket
    this.conexion = 'reconectando'

    socket.ev.on('creds.update', () => void saveCreds())
    socket.ev.on('messages.upsert', (u) => void this.alLlegarMensajes(u.messages as MensajeCrudo[]))
    socket.ev.on('groups.upsert', (grupos) => this.recordarNombres(grupos))
    socket.ev.on('groups.update', (grupos) => this.recordarNombres(grupos))

    await new Promise<void>((resolver) => {
      let resuelto = false
      const listo = () => {
        if (!resuelto) {
          resuelto = true
          resolver()
        }
      }

      socket.ev.on('connection.update', (u) => {
        if (u.qr) {
          this.conexion = 'requiere_autenticacion'
          this.opciones.registro.evento('aviso', 'qr_pendiente')
          this.opciones.alPedirQr?.(u.qr)
          // Con QR pendiente la conexión no se va a abrir sola: se resuelve
          // para que el proceso siga vivo y `/health` conteste.
          listo()
        }

        if (u.connection === 'open') {
          this.conexion = 'conectado'
          this.jidDeLaCuenta = normalizarJid(socket.user?.id ?? null)
          this.opciones.registro.evento('info', 'conectado', {
            cuenta: this.cuenta ?? 'desconocida',
          })
          void this.cargarNombresDeGrupos()
          listo()
        }

        if (u.connection === 'close') {
          const motivo = motivoDeCierre(u.lastDisconnect?.error)
          this.conexion = 'desconectado'
          listo()
          if (!this.detenido) {
            for (const c of this.caidas) c(motivo)
          }
        }
      })
    })
  }

  async desconectar(): Promise<void> {
    this.detenido = true
    // `end` y NO `logout`: cerrar el websocket deja la sesión intacta y el
    // proceso puede volver a arrancar sin QR. `logout` desvincula el
    // dispositivo de verdad, y eso lo decide una persona, no un `finally`.
    this.socket?.end(undefined)
    this.socket = null
    this.conexion = 'desconectado'
    return Promise.resolve()
  }

  /**
   * Los grupos de los que la cuenta es miembro, sólo con su id y su nombre.
   *
   * **Sin contenido**: es para poder decir «éstos son los grupos que hay» y
   * elegir cuál se autoriza. Que la cuenta sea miembro no autoriza nada.
   */
  async listarGrupos(): Promise<{ idExterno: string; nombre: string | null }[]> {
    if (!this.socket) return []
    const todos = await this.socket.groupFetchAllParticipating()
    return Object.values(todos).map((g) => ({
      idExterno: normalizarJid(g.id) ?? g.id,
      nombre: g.subject ?? null,
    }))
  }

  private recordarNombres(grupos: readonly { id?: string | null; subject?: string | null }[]): void {
    for (const g of grupos) {
      const id = normalizarJid(g.id ?? null)
      if (id && g.subject) this.nombres.set(id, g.subject)
    }
  }

  private async cargarNombresDeGrupos(): Promise<void> {
    try {
      const grupos = await this.listarGrupos()
      for (const g of grupos) if (g.nombre) this.nombres.set(g.idExterno, g.nombre)
      this.opciones.registro.evento('info', 'grupos_conocidos', { total: grupos.length })
    } catch (e) {
      this.opciones.registro.evento('aviso', 'grupos_no_leidos', { detalle: sanearError(e) })
    }
  }

  /**
   * Cada mensaje que llega.
   *
   * Un `upsert` puede traer un mensaje nuevo, una edición, un borrado o un
   * evento de protocolo que no nos importa. Se traduce todo acá y la decisión
   * de guardar o no la toma la política, que no sabe de WhatsApp.
   */
  private async alLlegarMensajes(mensajes: readonly MensajeCrudo[]): Promise<void> {
    for (const crudo of mensajes) {
      try {
        const contexto = {
          jidDeLaCuenta: this.jidDeLaCuenta,
          nombreDeGrupo: this.nombres.get(normalizarJid(crudo.key.remoteJid) ?? '') ?? null,
        }

        const protocolo = protocoloDe(crudo, contexto)
        if (protocolo) {
          await this.emitir({ clase: protocolo.clase, datos: protocolo.datos } as Evento)
          continue
        }

        const mensaje = normalizarMensaje(crudo, contexto)
        if (mensaje) await this.emitir({ clase: 'mensaje', datos: mensaje })
      } catch (e) {
        // Un mensaje con una forma inesperada no puede tirar el listener: se
        // cuenta y se sigue. Con una librería no oficial esto va a pasar.
        this.opciones.registro.evento('error', 'normalizacion_fallida', { detalle: sanearError(e) })
      }
    }
  }

  private async emitir(evento: Evento): Promise<void> {
    for (const e of this.escuchas) await e(evento)
  }
}

/**
 * Por qué se cortó, en una palabra.
 *
 * Baileys manda un `Boom` con el código en `output.statusCode`. Se traduce al
 * nombre de `DisconnectReason` porque un número suelto en un log no dice nada,
 * y porque `debeReintentar` entiende los dos.
 */
export function motivoDeCierre(error: unknown): string {
  // Se lee la forma, no la clase: `Boom` es una dependencia de Baileys, no
  // nuestra, y hacer `instanceof` contra el paquete de otro se rompe el día que
  // hay dos copias en el árbol.
  const codigo = (error as { output?: { statusCode?: unknown } } | null)?.output?.statusCode
  if (typeof codigo === 'number') {
    const nombre = Object.entries(DisconnectReason).find(([, v]) => v === codigo)?.[0]
    return nombre ? `${nombre} (${codigo})` : `codigo_${codigo}`
  }
  return sanearError(error)
}
