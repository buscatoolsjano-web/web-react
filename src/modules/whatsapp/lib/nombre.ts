import type { ConversacionListado } from '../types'

/**
 * Con qué nombre se muestra una conversación.
 *
 * El del cliente gana al de perfil de WhatsApp, y el de perfil al número: el
 * nombre de perfil lo elige el cliente y puede ser cualquier cosa, mientras
 * que la razón social es lo que la empresa usa para hablar de él.
 */
export function nombreVisible(c: Pick<ConversacionListado, 'clienteNombre' | 'perfil' | 'telefono'>): string {
  return c.clienteNombre ?? c.perfil ?? c.telefono ?? 'Sin identificar'
}
