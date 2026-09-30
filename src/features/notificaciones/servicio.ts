import { asignadosAMi } from '@/modules/emails/services/bandeja'
import { listarChats } from '@/modules/chat/services/chat'

/**
 * Las notificaciones (Fase 33 · E1).
 *
 * ── Por qué NO hay una tabla de notificaciones ──────────────────────────────
 *
 * Lo pedido es: avisame cuando me asignen un correo y cuando alguien me
 * escriba en el chat. Las dos cosas ya están en la base —un hilo con
 * `assigned_to` y sin leer, una conversación con mensajes sin leer—, así que
 * una tabla aparte sería una COPIA de ese estado.
 *
 * Y una copia se desincroniza: leés el correo desde la bandeja y la
 * notificación sigue ahí, porque nadie se acordó de marcarla. Derivándola, si
 * ya lo leíste la notificación desaparece sola, que es lo que uno espera.
 *
 * El día que haga falta un aviso que NO se derive de nada —«se cayó el sync de
 * STEL»— ahí sí va una tabla. Hoy no la hay.
 */

export interface Notificacion {
  id: string
  tipo: 'email' | 'chat'
  /** Quién lo generó: el remitente del correo, o quién escribió. */
  de: string
  titulo: string
  /** Un renglón de lo que dice, si lo hay. */
  detalle: string | null
  cuando: string | null
  /** A dónde lleva al tocarla. */
  destino: string
}

async function correosParaMi(companyId: string, userId: string): Promise<Notificacion[]> {
  try {
    const correos = await asignadosAMi(companyId, userId)
    return correos.map((c) => ({
      id: `email:${c.id}`,
      tipo: 'email' as const,
      de: c.de,
      titulo: c.asunto,
      detalle: c.resumen,
      cuando: c.cuando,
      destino: '/emails',
    }))
  } catch {
    // Un fallo no rompe el panel: se muestra lo que se pueda. Que no cargue
    // una fuente es mejor que no mostrar ninguna.
    return []
  }
}

/** Las conversaciones del chat con mensajes que todavía no leí. */
async function chatsParaMi(companyId: string): Promise<Notificacion[]> {
  try {
    const chats = await listarChats(companyId)
    return chats
      .filter((c) => (c.sinLeer ?? 0) > 0)
      .slice(0, 15)
      .map((c) => ({
        id: `chat:${c.id}`,
        tipo: 'chat' as const,
        de: c.conQuien ?? 'Alguien',
        titulo:
          (c.sinLeer ?? 0) === 1 ? 'Te escribió un mensaje' : `Te escribió ${c.sinLeer} mensajes`,
        detalle: c.ultimoMensaje ?? null,
        cuando: c.ultimoMensajeEn ?? null,
        destino: '/chat',
      }))
  } catch {
    return []
  }
}

/**
 * Todas las notificaciones, más recientes primero.
 *
 * Las dos fuentes se piden EN PARALELO: son independientes, y en serie la
 * espera sería la suma de las dos contra un servidor que está a 150 ms.
 */
export async function misNotificaciones(
  companyId: string,
  userId: string,
): Promise<Notificacion[]> {
  const [correos, chats] = await Promise.all([
    correosParaMi(companyId, userId),
    chatsParaMi(companyId),
  ])
  return [...correos, ...chats].sort((a, b) => (b.cuando ?? '').localeCompare(a.cuando ?? ''))
}
