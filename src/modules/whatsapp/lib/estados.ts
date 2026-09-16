/**
 * Cómo se muestra el estado de un mensaje saliente.
 *
 * El estado lo deriva la base (`estado_visible`, columna generada) con una
 * precedencia fija: leído gana a entregado, entregado gana a fallado y fallado
 * gana a enviado. Existe porque Meta puede mandar un acuse de éxito y uno de
 * fallo del MISMO mensaje, desde dos dispositivos del cliente; el último
 * webhook que llega no es la verdad.
 *
 * Acá sólo se traduce. Nunca se recalcula.
 */

export type EstadoVisible = 'pending' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'received'

export interface EstadoPresentable {
  /** Texto para lectores de pantalla y para el título: nunca sólo el ícono. */
  etiqueta: string
  /** Marca visual: una, dos, dos en color, reloj o alerta. */
  marca: 'reloj' | 'tilde' | 'doble' | 'doble-leido' | 'alerta'
  esError: boolean
}

const TABLA: Record<EstadoVisible, EstadoPresentable> = {
  pending: { etiqueta: 'En cola', marca: 'reloj', esError: false },
  sending: { etiqueta: 'Enviando', marca: 'reloj', esError: false },
  sent: { etiqueta: 'Enviado', marca: 'tilde', esError: false },
  delivered: { etiqueta: 'Entregado', marca: 'doble', esError: false },
  read: { etiqueta: 'Leído', marca: 'doble-leido', esError: false },
  failed: { etiqueta: 'No se pudo enviar', marca: 'alerta', esError: true },
  received: { etiqueta: 'Recibido', marca: 'tilde', esError: false },
}

export function presentarEstado(estado: string | null): EstadoPresentable {
  return TABLA[(estado ?? 'pending') as EstadoVisible] ?? TABLA.pending
}

/**
 * Qué se ve en la lista cuando el mensaje no es texto.
 *
 * El modelo guarda el tipo aunque la pantalla todavía no sepa dibujarlo: un
 * mensaje que no se puede renderizar igual tiene que poder nombrarse.
 */
const TIPO: Record<string, string> = {
  text: 'Mensaje',
  image: 'Imagen',
  document: 'Documento',
  audio: 'Audio',
  video: 'Video',
  sticker: 'Sticker',
  location: 'Ubicación',
  contacts: 'Contacto',
  interactive: 'Respuesta a un botón',
  reaction: 'Reacción',
  button: 'Respuesta a un botón',
  order: 'Pedido del catálogo',
  system: 'Aviso de WhatsApp',
  unknown: 'Mensaje no soportado',
}

export function nombreDeTipo(tipo: string | null): string {
  return TIPO[tipo ?? 'unknown'] ?? TIPO.unknown!
}

/** Los tipos que el chat sabe dibujar hoy; el resto se nombra y se explica. */
export const TIPOS_RENDERIZABLES = ['text', 'image', 'sticker', 'document', 'audio', 'video'] as const

export function seDibuja(tipo: string | null): boolean {
  return (TIPOS_RENDERIZABLES as readonly string[]).includes(tipo ?? '')
}
