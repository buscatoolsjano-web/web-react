/**
 * Tipos del chat interno (Fase 28 · E15).
 *
 * Es la única pieza de Comunicación que no habla con afuera: son las personas
 * de la empresa entre ellas. Nada de esto sale del ERP.
 */

/** Alguien de la empresa con quien se puede hablar. */
export interface UsuarioDeChat {
  id: string
  nombre: string
  rol: string
}

/** Una conversación, como se ve en la lista. */
export interface Conversacion {
  id: string
  /** Con quién: el otro participante, o todos los otros si algún día hay grupos. */
  conQuien: string
  /** El id del otro, cuando la conversación es de a dos. */
  conQuienId: string | null
  ultimoMensaje: string | null
  ultimoMensajeEn: string | null
  /** Sin leer POR MÍ: cada participante lleva el suyo. */
  sinLeer: number
}

export interface MensajeChat {
  id: string
  conversacionId: string
  autorId: string
  autorNombre: string
  texto: string
  creadoEn: string
  /** Lo escribí yo: la burbuja va del otro lado. */
  esMio: boolean
}
