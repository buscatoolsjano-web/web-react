import { asignadosAMi, avisosDeSincronizacion } from '@/modules/emails/services/bandeja'
import { listarChats } from '@/modules/chat/services/chat'
import { listarConsultas } from '@/modules/ventas/services/consultas'

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
  tipo: 'email' | 'chat' | 'alerta'
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
      /*
       * Al hilo, no a la bandeja.
       *
       * Llevaba a `/emails` y eso obligaba a buscar a mano, entre mil
       * noventa hilos, el mismo correo que la notificación acababa de
       * mostrar. El id es el de `email_threads` —el mismo que usa cada
       * fila del listado para enlazar— porque las dos cosas salen de
       * `listar_bandeja_email`.
       */
      destino: `/emails/${c.id}`,
    }))
  } catch {
    // Un fallo no rompe el panel: se muestra lo que se pueda. Que no cargue
    // una fuente es mejor que no mostrar ninguna.
    return []
  }
}

/**
 * Los problemas de la bandeja: que el correo haya dejado de entrar.
 *
 * Es la única fuente que NO es personal —le pasa a la empresa, no a uno— y va
 * igual acá, arriba de todo. Un aviso de que el correo dejó de entrar no sirve
 * escondido en una pantalla de configuración que nadie abre: tiene que estar
 * donde la gente ya mira.
 *
 * Y es lo que faltaba el 28/09: el correo se cortó y nada avisó.
 */
async function problemasDeCorreo(companyId: string): Promise<Notificacion[]> {
  try {
    const avisos = await avisosDeSincronizacion(companyId)
    return avisos.map((a) => ({
      id: `alerta:${a.clave}:${a.cuenta}`,
      tipo: 'alerta' as const,
      de: a.cuenta,
      titulo: a.titulo,
      detalle: a.detalle,
      // Sin fecha a propósito: al ordenar por fecha descendente, el vacío
      // queda último. Se reinserta adelante en `misNotificaciones`.
      cuando: null,
      destino: '/emails',
    }))
  } catch {
    return []
  }
}

/**
 * A dónde lleva una notificación de chat.
 *
 * Sin con quién —una fila sin conversación ni persona— lleva al chat a secas,
 * que es lo único honesto: abrir una conversación que no existe mostraría una
 * pantalla vacía sin decir por qué.
 */
function destinoDeChat(conQuien: string | null): string {
  return conQuien === null ? '/chat' : `/chat?con=${encodeURIComponent(conQuien)}`
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
        /*
         * A la conversación, no al chat.
         *
         * Va la PERSONA y no la conversación, que es lo que `ChatPage` usa
         * para saber qué abrir: una fila sin conversación todavía no tiene
         * id, y cuando se crea al mandar el primer mensaje la fila sigue
         * siendo la misma.
         */
        destino: destinoDeChat(c.conQuienId ?? c.id),
      }))
  } catch {
    return []
  }
}

/**
 * Las consultas del sitio público sin atender (Fase 87 · E4).
 *
 * «Cuando se envía la consulta, que nos llegue a nosotros en el ERP.» Son de
 * la EMPRESA y no de una persona —nadie las tiene asignadas todavía—, así que
 * se las ve toda la gente de la casa, como las alertas. Cada una sin atender
 * es una notificación; apenas alguien la marca contactada, desaparece sola,
 * que es la misma lógica de derivar en vez de copiar.
 */
async function consultasSinAtender(companyId: string): Promise<Notificacion[]> {
  try {
    const consultas = await listarConsultas(companyId, 'nueva')
    return consultas.slice(0, 20).map((c) => ({
      id: `consulta:${c.id}`,
      tipo: 'alerta' as const,
      de: c.empresa ? `${c.nombre} · ${c.empresa}` : c.nombre,
      titulo:
        c.cantidadItems > 0
          ? `Pide cotización de ${c.cantidadItems} ${c.cantidadItems === 1 ? 'producto' : 'productos'}`
          : 'Dejó una consulta',
      detalle: c.mensaje ?? (c.items.map((i) => i.sku).slice(0, 3).join(', ') || null),
      cuando: c.cuando,
      // Se mudó a Web (Fase 115); la ruta vieja igual redirige, pero mejor directo.
      destino: '/web/consultas',
    }))
  } catch {
    return []
  }
}

/**
 * Todas las notificaciones, más recientes primero.
 *
 * Las fuentes se piden EN PARALELO: son independientes, y en serie la espera
 * sería la suma contra un servidor que está a 150 ms.
 */
export async function misNotificaciones(
  companyId: string,
  userId: string,
): Promise<Notificacion[]> {
  const [problemas, consultas, correos, chats] = await Promise.all([
    problemasDeCorreo(companyId),
    consultasSinAtender(companyId),
    correosParaMi(companyId, userId),
    chatsParaMi(companyId),
  ])
  // Los problemas van SIEMPRE primero, sin importar la fecha: que el correo
  // haya dejado de entrar importa más que cualquier mensaje suelto, y además
  // explica por qué la lista de abajo puede estar vacía. Las consultas del
  // público van después, que son un cliente nuevo esperando respuesta.
  const personales = [...correos, ...chats].sort((a, b) =>
    (b.cuando ?? '').localeCompare(a.cuando ?? ''),
  )
  return [...problemas, ...consultas, ...personales]
}
