import type { EstadoDeConexion, Evento } from './tipos.js'

/**
 * La única frontera con la librería no oficial.
 *
 * Todo lo que Baileys tiene de riesgoso —protocolo que cambia, sesión que se
 * cae, API que se rompe entre versiones— queda de este lado. El resto del
 * listener recibe `Evento` y no sabe de dónde salieron.
 *
 * En esta entrega la única implementación es `TransporteMock`: **no se conecta
 * ningún número**. La implementación real se escribe cuando haya una cuenta de
 * prueba descartable, y va a vivir en su propio archivo sin tocar nada de acá.
 */
export interface Transporte {
  /** Arranca y empieza a emitir. Resuelve cuando quedó escuchando. */
  conectar(): Promise<void>
  /** Corta sin borrar la sesión: se puede volver a conectar. */
  desconectar(): Promise<void>
  estado(): EstadoDeConexion
  /** Se llama una vez; el transporte empuja los eventos que van llegando. */
  alRecibir(escucha: (evento: Evento) => void | Promise<void>): void
  /** Se llama cuando la conexión se cae, para que el listener decida. */
  alCaerse(escucha: (motivo: string) => void): void
}

/**
 * Un transporte de mentira, manejado desde el test.
 *
 * Sirve para dos cosas: probar la lógica entera sin WhatsApp, y ensayar un
 * grupo de verdad —con sus respuestas, sus adjuntos y sus ediciones— antes de
 * conectar nada.
 */
export class TransporteMock implements Transporte {
  private escuchas: ((evento: Evento) => void | Promise<void>)[] = []
  private caidas: ((motivo: string) => void)[] = []
  private conexion: EstadoDeConexion = 'desconectado'

  conectar(): Promise<void> {
    this.conexion = 'conectado'
    return Promise.resolve()
  }

  desconectar(): Promise<void> {
    this.conexion = 'desconectado'
    return Promise.resolve()
  }

  estado(): EstadoDeConexion {
    return this.conexion
  }

  alRecibir(escucha: (evento: Evento) => void | Promise<void>): void {
    this.escuchas.push(escucha)
  }

  alCaerse(escucha: (motivo: string) => void): void {
    this.caidas.push(escucha)
  }

  /** El test empuja un evento como si lo hubiera mandado WhatsApp. */
  async emitir(evento: Evento): Promise<void> {
    for (const e of this.escuchas) await e(evento)
  }

  /** El test simula que se cortó la conexión. */
  caerse(motivo: string): void {
    this.conexion = 'reconectando'
    for (const c of this.caidas) c(motivo)
  }
}
