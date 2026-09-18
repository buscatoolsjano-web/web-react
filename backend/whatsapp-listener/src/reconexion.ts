/**
 * Cuándo reintentar después de una caída.
 *
 * Es una función pura porque es fácil equivocarse acá y difícil darse cuenta:
 * un backoff mal hecho contra un servidor que ya está rechazando la conexión es
 * la forma más rápida de que WhatsApp marque a la cuenta. Con una librería no
 * oficial eso puede terminar en un baneo del número, así que el reintento es
 * lento a propósito.
 */

export const ESPERA_INICIAL_MS = 5_000
export const ESPERA_MAXIMA_MS = 5 * 60_000

/**
 * Exponencial con tope y con ruido.
 *
 * El ruido (±20 %) evita que varias instancias reintenten en el mismo
 * milisegundo después de una caída compartida.
 */
export function esperaDeReintento(intento: number, azar: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(intento))
  const base = Math.min(ESPERA_INICIAL_MS * 2 ** (n - 1), ESPERA_MAXIMA_MS)
  const ruido = 1 + (azar() - 0.5) * 0.4
  return Math.round(Math.min(base * ruido, ESPERA_MAXIMA_MS))
}

/**
 * ¿Reintentar, o parar y pedir que alguien mire?
 *
 * Hay dos clases de caída y confundirlas es el error clásico: una red que se
 * cortó se arregla sola reintentando; una sesión cerrada desde el teléfono
 * («logout», «401») **no se arregla nunca** reintentando, y seguir intentando
 * es golpear la puerta. Ésa requiere vincular de nuevo, y eso lo hace una
 * persona.
 */
export function debeReintentar(motivo: string): boolean {
  // Se normaliza antes de comparar porque el mismo motivo llega escrito de
  // varias formas según de dónde salga: `loggedOut` es el nombre de la constante
  // de la librería, `logged_out` el de la base, `logged out` el de un mensaje de
  // error. Buscar sólo una de las tres es no encontrar ninguna el día que
  // importa.
  const m = motivo.toLowerCase().replace(/[\s_-]/g, '')
  const definitivos = ['loggedout', 'logout', 'unauthorized', '401', 'sesioninvalida', 'banned']
  return !definitivos.some((d) => m.includes(d))
}
