import type { BorradoObservado, EdicionObservada, GrupoObservado, MensajeObservado } from './tipos.js'

/**
 * La frontera con la base.
 *
 * El listener no sabe de Supabase: sabe de esta interfaz. Eso permite probar
 * toda la lógica —allowlist, idempotencia, replies, media, ediciones, borrados—
 * sin base, sin red y sin cuenta de WhatsApp, que es exactamente lo que pide
 * esta entrega.
 *
 * `ResultadoDeIngreso` distingue `guardado` de `duplicado` a propósito: un
 * reconnect vuelve a emitir mensajes que ya entraron, y el listener necesita
 * poder contarlos sin tratarlos como error.
 */

export type ResultadoDeIngreso =
  | { estado: 'guardado'; mensajeId: string; conversacionId: string }
  | { estado: 'duplicado' }

export interface Repositorio {
  /**
   * Guarda un mensaje de grupo. Tiene que ser IDEMPOTENTE por
   * `(cuenta, idExterno)`: la misma llamada dos veces deja una fila.
   */
  ingresarMensaje(m: MensajeObservado): Promise<ResultadoDeIngreso>

  /** Actualiza el texto de un mensaje que ya existe. No crea uno nuevo. */
  registrarEdicion(e: EdicionObservada): Promise<'aplicada' | 'sin_efecto'>

  /**
   * Marca un mensaje como borrado. **No borra la fila**: el contenido se oculta
   * en la pantalla, pero que el mensaje existió es parte de la historia.
   */
  registrarBorrado(b: BorradoObservado): Promise<'aplicada' | 'sin_efecto'>

  /** Guarda el nombre del grupo y quiénes están. */
  registrarGrupo(g: GrupoObservado): Promise<void>
}

interface FilaDeMensaje {
  idExterno: string
  conversacionId: string
  autorIdExterno: string
  autorNombre: string | null
  sentido: string
  enviadoEn: Date
  tipoDeMensaje: string
  texto: string | null
  respondeA: string | null
  media: MensajeObservado['media']
  editadoEn: Date | null
  borradoEn: Date | null
  borradoPor: string | null
}

/**
 * La implementación de mentira, que es la que corren los tests.
 *
 * Reproduce las dos garantías que da el schema real y que importan acá: una
 * conversación por grupo —el índice único `uq_wa_conv_contacto`— y un mensaje
 * por `(cuenta, id del proveedor)` —el índice único `uq_wa_msg_provider`—. Si
 * el prototipo pasa contra esto, pasa contra la base.
 */
export class RepositorioEnMemoria implements Repositorio {
  readonly conversaciones = new Map<string, { id: string; nombre: string | null }>()
  readonly mensajes = new Map<string, FilaDeMensaje>()
  readonly participantes = new Map<string, Map<string, string | null>>()

  private secuencia = 0

  private conversacionDe(idGrupo: string, nombre: string | null): string {
    const previa = this.conversaciones.get(idGrupo)
    if (previa) {
      // El nombre se refresca; la identidad no cambia nunca.
      if (nombre !== null) previa.nombre = nombre
      return previa.id
    }
    this.secuencia += 1
    const id = `conv-${this.secuencia}`
    this.conversaciones.set(idGrupo, { id, nombre })
    return id
  }

  ingresarMensaje(m: MensajeObservado): Promise<ResultadoDeIngreso> {
    if (this.mensajes.has(m.idExterno)) {
      return Promise.resolve({ estado: 'duplicado' })
    }
    const conversacionId = this.conversacionDe(m.chat.idExterno, m.chat.nombre)
    this.mensajes.set(m.idExterno, {
      idExterno: m.idExterno,
      conversacionId,
      autorIdExterno: m.autor.idExterno,
      autorNombre: m.autor.nombreVisible,
      sentido: m.sentido,
      enviadoEn: m.enviadoEn,
      tipoDeMensaje: m.tipoDeMensaje,
      texto: m.texto,
      respondeA: m.respondeA,
      media: m.media,
      editadoEn: null,
      borradoEn: null,
      borradoPor: null,
    })
    return Promise.resolve({ estado: 'guardado', mensajeId: m.idExterno, conversacionId })
  }

  registrarEdicion(e: EdicionObservada): Promise<'aplicada' | 'sin_efecto'> {
    const fila = this.mensajes.get(e.idExterno)
    // Una edición de un mensaje que nunca entró no crea nada: el mensaje
    // original quedó afuera por la allowlist, o es anterior a la conexión.
    if (!fila) return Promise.resolve('sin_efecto')
    fila.texto = e.textoNuevo
    fila.editadoEn = e.editadoEn
    return Promise.resolve('aplicada')
  }

  registrarBorrado(b: BorradoObservado): Promise<'aplicada' | 'sin_efecto'> {
    const fila = this.mensajes.get(b.idExterno)
    if (!fila) return Promise.resolve('sin_efecto')
    fila.borradoEn = b.borradoEn
    fila.borradoPor = b.borradoPor
    // El texto NO se toca: se marca como borrado y la pantalla decide. Inventar
    // «mensaje eliminado» en el lugar del contenido sería perder el dato.
    return Promise.resolve('aplicada')
  }

  registrarGrupo(g: GrupoObservado): Promise<void> {
    this.conversacionDe(g.idExterno, g.nombre)
    const mapa = this.participantes.get(g.idExterno) ?? new Map<string, string | null>()
    for (const p of g.participantes) mapa.set(p.idExterno, p.nombreVisible)
    this.participantes.set(g.idExterno, mapa)
    return Promise.resolve()
  }
}
