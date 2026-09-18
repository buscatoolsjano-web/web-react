/**
 * El vocabulario del listener, independiente de la librería.
 *
 * Nada de acá menciona Baileys. Ese es el punto: la librería no oficial es la
 * pieza más frágil de todo esto —WhatsApp cambia el protocolo y el cliente se
 * rompe— así que el resto del sistema habla un idioma propio y la librería vive
 * detrás de una sola frontera, `Transporte`. Cambiarla, o reemplazarla el día
 * que exista una API oficial de grupos, no debería tocar nada más.
 */

/** Un chat de WhatsApp, ya clasificado. */
export type TipoDeChat = 'grupo' | 'directo'

/**
 * Quién escribió, desde el punto de vista de la cuenta que escucha.
 *
 * `saliente` es lo que escribió la cuenta vinculada —desde el celular, desde
 * WhatsApp Web, desde donde sea—. `entrante` es todo lo demás. Ojo: esto NO
 * identifica al autor en un grupo; para eso está `autor`. En un grupo de ocho
 * personas, siete escriben `entrante` y son siete personas distintas.
 */
export type Sentido = 'entrante' | 'saliente'

export interface Autor {
  /** El identificador estable del participante. Nunca el nombre. */
  idExterno: string
  /** Cómo se llama hoy. Cambia, y por eso no es identidad. */
  nombreVisible: string | null
}

export interface ReferenciaDeMedia {
  tipo: string
  mime: string | null
  /** Bytes, si el proveedor lo informa antes de descargar. */
  bytes: number | null
  /** El id del proveedor para pedir el archivo DESPUÉS, si alguien lo pide. */
  idExterno: string | null
  nombreArchivo: string | null
}

/** Un mensaje de un chat, ya normalizado. */
export interface MensajeObservado {
  /** Id del mensaje en el proveedor. Es la clave de idempotencia. */
  idExterno: string
  chat: {
    idExterno: string
    tipo: TipoDeChat
    /** Sólo en grupos, y sólo si el proveedor lo informó. */
    nombre: string | null
  }
  autor: Autor
  sentido: Sentido
  /** Cuándo lo mandó quien lo mandó, no cuándo llegó acá. */
  enviadoEn: Date
  tipoDeMensaje: string
  texto: string | null
  /** El mensaje citado, si es una respuesta. */
  respondeA: string | null
  media: ReferenciaDeMedia | null
}

/** Una edición de un mensaje que ya existe. */
export interface EdicionObservada {
  idExterno: string
  chat: { idExterno: string; tipo: TipoDeChat }
  textoNuevo: string | null
  editadoEn: Date
}

/** Un borrado. El contenido no se reemplaza: se marca. */
export interface BorradoObservado {
  idExterno: string
  chat: { idExterno: string; tipo: TipoDeChat }
  /** Quién lo borró, si el proveedor lo dice. */
  borradoPor: string | null
  borradoEn: Date
}

/** Metadata del grupo: llega al conectar y cuando alguien la cambia. */
export interface GrupoObservado {
  idExterno: string
  nombre: string | null
  participantes: Autor[]
}

export type Evento =
  | { clase: 'mensaje'; datos: MensajeObservado }
  | { clase: 'edicion'; datos: EdicionObservada }
  | { clase: 'borrado'; datos: BorradoObservado }
  | { clase: 'grupo'; datos: GrupoObservado }

/** En qué anda la conexión. Es lo que contesta `/health`. */
export type EstadoDeConexion =
  | 'conectado'
  | 'desconectado'
  | 'requiere_autenticacion'
  | 'reconectando'
  | 'apagado'

/** Por qué se descartó un evento. Se cuenta; no se guarda contenido. */
export type MotivoDeDescarte =
  | 'listener_apagado'
  | 'chat_directo'
  | 'grupo_no_autorizado'
  | 'sin_texto_ni_media'
  | 'duplicado'
