import type { Evento, MensajeObservado, MotivoDeDescarte } from './tipos.js'

/**
 * Qué se ingiere y qué no. Función pura, sin red y sin base.
 *
 * Es la pieza que decide sobre conversaciones internas de la empresa, así que
 * está separada, es chica y se lee entera. Las tres reglas:
 *
 *   1. si el listener está apagado, no entra nada —ni siquiera se mira—;
 *   2. **los chats privados no se ingieren nunca**: este sistema es para grupos
 *      de trabajo, no para leerle los mensajes a nadie;
 *   3. un grupo entra sólo si está en la allowlist. No alcanza con que la
 *      cuenta sea miembro: alguien tuvo que autorizarlo explícitamente.
 *
 * El default es NO. Un grupo nuevo en el que alguien meta a la cuenta no se
 * guarda hasta que una persona lo habilite.
 */

export interface GrupoAutorizado {
  idExterno: string
  /** `false` lo saca de la ingesta sin perder lo ya guardado. */
  habilitado: boolean
  /** `false` guarda los mensajes pero no los manda a la IA. */
  iaHabilitada: boolean
}

export interface Politica {
  listenerHabilitado: boolean
  grupos: readonly GrupoAutorizado[]
}

export type Decision =
  | { admitido: true; iaHabilitada: boolean }
  | { admitido: false; motivo: MotivoDeDescarte }

function grupoDe(politica: Politica, idExterno: string): GrupoAutorizado | null {
  return politica.grupos.find((g) => g.idExterno === idExterno) ?? null
}

/** ¿Este mensaje se guarda? */
export function decidirMensaje(politica: Politica, m: MensajeObservado): Decision {
  if (!politica.listenerHabilitado) {
    return { admitido: false, motivo: 'listener_apagado' }
  }
  if (m.chat.tipo !== 'grupo') {
    // Un privado de esta cuenta no es asunto del sistema. Se cuenta y se tira.
    return { admitido: false, motivo: 'chat_directo' }
  }

  const grupo = grupoDe(politica, m.chat.idExterno)
  if (grupo === null || !grupo.habilitado) {
    return { admitido: false, motivo: 'grupo_no_autorizado' }
  }

  // Un mensaje sin texto ni adjunto no aporta nada: una reacción, un evento de
  // sistema, un cambio de asunto. Guardarlo sería ruido en el hilo y en el
  // prompt.
  if ((m.texto === null || m.texto.trim() === '') && m.media === null) {
    return { admitido: false, motivo: 'sin_texto_ni_media' }
  }

  return { admitido: true, iaHabilitada: grupo.iaHabilitada }
}

/**
 * Las ediciones y los borrados siguen la misma regla que el mensaje original:
 * si el grupo no está autorizado, no hay nada que editar ni que borrar.
 */
export function decidirEvento(politica: Politica, evento: Evento): Decision {
  if (!politica.listenerHabilitado) {
    return { admitido: false, motivo: 'listener_apagado' }
  }
  if (evento.clase === 'mensaje') return decidirMensaje(politica, evento.datos)

  const chat = evento.clase === 'grupo'
    ? { idExterno: evento.datos.idExterno, tipo: 'grupo' as const }
    : evento.datos.chat

  if (chat.tipo !== 'grupo') return { admitido: false, motivo: 'chat_directo' }

  const grupo = grupoDe(politica, chat.idExterno)
  if (grupo === null || !grupo.habilitado) {
    return { admitido: false, motivo: 'grupo_no_autorizado' }
  }
  return { admitido: true, iaHabilitada: grupo.iaHabilitada }
}
