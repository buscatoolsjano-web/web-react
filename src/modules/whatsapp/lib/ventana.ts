/**
 * La ventana de servicio de Meta.
 *
 * WhatsApp permite escribir texto libre sólo durante **24 horas** desde el
 * último mensaje del cliente. Pasado ese plazo hay que mandar una plantilla
 * aprobada, que además se cobra.
 *
 * Esto de acá es SÓLO para que la pantalla lo diga. Lo que impide mandar es
 * `encolar_mensaje_whatsapp`, que revalida la ventana en la base: si el
 * navegador tiene la hora mal o alguien llama la función a mano, el que corta
 * es el servidor.
 */

export type EstadoVentana = 'abierta' | 'por_cerrar' | 'cerrada' | 'sin_contacto'

export interface VentanaPresentable {
  estado: EstadoVentana
  /** Una línea para la persona. */
  texto: string
  /** `true` si se puede escribir texto libre. */
  puedeEscribir: boolean
}

/** Cuando falta menos de esto, conviene avisar antes de que se cierre. */
const AVISO_MS = 2 * 60 * 60 * 1000

function faltante(ms: number): string {
  const horas = Math.floor(ms / 3_600_000)
  const minutos = Math.floor((ms % 3_600_000) / 60_000)
  if (horas >= 1) return `${horas} h ${String(minutos).padStart(2, '0')} min`
  return `${minutos} min`
}

/**
 * `HH:mm` en la hora de quien mira, en 24 horas.
 *
 * `hourCycle: 'h23'` y no el formato de 12: «02:10 p. m.» termina en punto y
 * al meterlo en una oración quedaba «hasta las 02:10 p. m..». Además, en un
 * registro de mensajes el reloj de 24 horas se lee de un vistazo.
 */
export function horaCorta(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
}

/**
 * Cuándo vence, nombrando el día cuando no es hoy.
 *
 * Sin el día, una ventana que cierra mañana a las 14:10 se lee «hasta las
 * 14:10» a las 14:22 de hoy: exactamente como si ya hubiera vencido. Y la
 * ventana es de 24 horas, así que casi siempre cae al día siguiente, a la
 * misma hora del reloj. La hora sola sólo alcanza cuando vence hoy.
 */
export function cuandoVence(iso: string, ahora: Date): string {
  const d = new Date(iso)
  const hora = horaCorta(iso)
  if (d.toDateString() === ahora.toDateString()) return 'las ' + hora
  const manana = new Date(ahora.getTime() + 86_400_000)
  if (d.toDateString() === manana.toDateString()) return 'mañana a las ' + hora
  const fecha = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit' }).format(d)
  return 'el ' + fecha + ' a las ' + hora
}

export function presentarVentana(
  venceEn: string | null,
  ahora: Date = new Date(),
): VentanaPresentable {
  if (!venceEn) {
    return {
      estado: 'sin_contacto',
      texto: 'El cliente todavía no escribió. Hasta que lo haga no se puede iniciar la conversación desde acá.',
      puedeEscribir: false,
    }
  }

  const vence = new Date(venceEn)
  if (Number.isNaN(vence.getTime())) {
    return { estado: 'cerrada', texto: 'No se pudo determinar la ventana de respuesta.', puedeEscribir: false }
  }

  const restante = vence.getTime() - ahora.getTime()
  if (restante <= 0) {
    return {
      estado: 'cerrada',
      texto: 'Pasaron más de 24 horas desde el último mensaje del cliente. Para escribirle hace falta una plantilla aprobada por Meta.',
      puedeEscribir: false,
    }
  }
  if (restante <= AVISO_MS) {
    return {
      estado: 'por_cerrar',
      texto: `Podés responder hasta ${cuandoVence(venceEn, ahora)} (faltan ${faltante(restante)}).`,
      puedeEscribir: true,
    }
  }
  return {
    estado: 'abierta',
    texto: `Respuesta libre hasta ${cuandoVence(venceEn, ahora)}.`,
    puedeEscribir: true,
  }
}
