import { Ingesta } from './ingesta.js'
import type { Politica } from './politica.js'
import { debeReintentar, esperaDeReintento } from './reconexion.js'
import type { Repositorio } from './repositorio.js'
import { sanearError, type Registro } from './registro.js'
import type { Transporte } from './transporte.js'
import type { EstadoDeConexion } from './tipos.js'

/**
 * El listener: junta el transporte, la política y el repositorio.
 *
 * Todo lo difícil vive afuera y probado aparte —la decisión de qué se ingiere,
 * el backoff, la idempotencia—. Acá sólo queda el cableado y el ciclo de
 * reconexión, que es el que no se puede probar del todo sin una caída real.
 */
export class Listener {
  private readonly ingesta: Ingesta
  private estadoActual: EstadoDeConexion = 'desconectado'
  private intentos = 0
  private ultimoEventoEn: Date | null = null
  private ultimoMotivo: string | null = null
  private detenido = false
  private temporizador: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly transporte: Transporte,
    repositorio: Repositorio,
    private readonly politica: () => Politica,
    private readonly registro: Registro,
    private readonly dormir: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => {
        setTimeout(r, ms)
      }),
  ) {
    this.ingesta = new Ingesta(repositorio, politica, registro)

    this.transporte.alRecibir(async (evento) => {
      this.ultimoEventoEn = new Date()
      await this.ingesta.procesar(evento)
    })

    this.transporte.alCaerse((motivo) => {
      void this.manejarCaida(motivo)
    })
  }

  get contadores() {
    return this.ingesta.contadores
  }

  get ultimoEvento(): string | null {
    return this.ultimoEventoEn?.toISOString() ?? null
  }

  /**
   * El estado REAL del socket, sin el filtro del kill switch.
   *
   * Existe porque «apagado» y «nunca se conectó» se veían igual en `/health`, y
   * son dos cosas muy distintas: una es normal y la otra hay que atenderla.
   * Apareció mirando el healthcheck justo después de vincular el teléfono: la
   * cuenta estaba conectada y la pantalla decía lo mismo que si no lo estuviera.
   */
  get conexion(): EstadoDeConexion {
    return this.estadoActual
  }

  /** El último motivo de caída, saneado. Para `/health`, no para decidir nada. */
  get motivo(): string | null {
    return this.ultimoMotivo
  }

  /**
   * Qué contestar.
   *
   * «Apagado» tapa el estado real sólo cuando no hay nada que atender. Si la
   * sesión pide vincularse o la conexión se está reintentando, eso gana: son
   * las dos cosas que necesitan que alguien haga algo, y esconderlas detrás
   * del kill switch sería un healthcheck que miente en verde.
   */
  estado(): EstadoDeConexion {
    if (this.estadoActual === 'requiere_autenticacion' || this.estadoActual === 'reconectando') {
      return this.estadoActual
    }
    if (!this.politica().listenerHabilitado) return 'apagado'
    return this.estadoActual
  }

  async iniciar(): Promise<void> {
    this.detenido = false
    // Apagado NO significa desconectar: la sesión se conserva, simplemente no
    // se ingiere. Volver a encenderlo no debería pedir vincular de nuevo.
    await this.transporte.conectar()
    this.estadoActual = this.transporte.estado()
    this.intentos = 0
    if (this.estadoActual === 'conectado') this.ultimoMotivo = null
    this.registro.evento('info', 'listener_conectado', { estado: this.estado() })
  }

  async detener(): Promise<void> {
    this.detenido = true
    if (this.temporizador) clearTimeout(this.temporizador)
    await this.transporte.desconectar()
    this.estadoActual = 'desconectado'
    this.registro.evento('info', 'listener_detenido')
  }

  private async manejarCaida(motivo: string): Promise<void> {
    if (this.detenido) return

    if (!debeReintentar(motivo)) {
      // La sesión se cerró del otro lado. Reintentar no la va a reabrir, y
      // machacar la puerta con un cliente no oficial es cómo se gana un baneo.
      this.estadoActual = 'requiere_autenticacion'
      this.ultimoMotivo = sanearError(motivo)
      this.registro.evento('error', 'sesion_invalida', { detalle: sanearError(motivo) })
      return
    }

    this.intentos += 1
    this.ultimoMotivo = sanearError(motivo)
    this.estadoActual = 'reconectando'
    const espera = esperaDeReintento(this.intentos)
    this.registro.evento('aviso', 'reconectando', { intento: this.intentos, esperaMs: espera })

    await this.dormir(espera)
    if (this.detenido) return

    try {
      await this.transporte.conectar()
      this.estadoActual = this.transporte.estado()
      this.intentos = 0
      if (this.estadoActual === 'conectado') this.ultimoMotivo = null
      this.registro.evento('info', 'reconectado')
    } catch (e) {
      this.registro.evento('error', 'reconexion_fallida', { detalle: sanearError(e) })
      void this.manejarCaida('network')
    }
  }
}
