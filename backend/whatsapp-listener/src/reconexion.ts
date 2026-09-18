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
/**
 * Las caídas que NO se arreglan reintentando.
 *
 * Los nombres salen de `DisconnectReason` de Baileys y los códigos también,
 * porque el motivo llega de las dos formas según por dónde pase:
 *
 * - **401 `loggedOut`** — alguien desvinculó el dispositivo desde el teléfono.
 * - **403 `forbidden`** — la cuenta está bloqueada. Reintentar contra un baneo
 *   es la mejor forma de confirmarlo.
 * - **440 `connectionReplaced`** — otra instancia tomó la sesión. Si las dos
 *   reintentan, se turnan para echarse hasta que WhatsApp corte por su cuenta.
 * - **411 `multideviceMismatch`** y **500 `badSession`** — la sesión quedó
 *   inservible; hay que vincular de nuevo.
 *
 * `515 restartRequired` **no** está en la lista, y es importante: es lo normal
 * justo después de vincular, y ahí hay que reconectar sí o sí.
 */
const DEFINITIVOS = [
  'loggedout',
  'logout',
  'unauthorized',
  '401',
  'forbidden',
  '403',
  'connectionreplaced',
  '440',
  'multidevicemismatch',
  '411',
  'badsession',
  '500',
  'sesioninvalida',
  'banned',
]

export function debeReintentar(motivo: string): boolean {
  // Se normaliza antes de comparar porque el mismo motivo llega escrito de
  // varias formas según de dónde salga: `loggedOut` es el nombre de la constante
  // de la librería, `logged_out` el de la base, `logged out` el de un mensaje de
  // error. Buscar sólo una de las tres es no encontrar ninguna el día que
  // importa.
  const m = motivo.toLowerCase().replace(/[\s_-]/g, '')
  return !DEFINITIVOS.some((d) => m.includes(d))
}
