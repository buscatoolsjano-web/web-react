/**
 * Reintentos contra Gmail — la deuda de la entrega 3, cerrada.
 *
 * No todo se puede reintentar igual. La pregunta no es «¿falló?» sino «¿Gmail
 * pudo haberlo hecho igual?»:
 *
 *   · `lectura`         GET. Reintentar nunca cambia nada.
 *   · `idempotente`     drafts.update, drafts.delete, watch. Repetirlo deja el
 *                       mismo resultado.
 *   · `no_idempotente`  drafts.create, messages.send, drafts.send. Repetir un
 *                       send que Gmail YA aceptó manda el mail dos veces.
 *
 * Un 429 dice que Gmail NO procesó el pedido: se reintenta en las tres. Un 5xx,
 * un corte de red o un timeout NO dicen si lo procesó: en `no_idempotente` NO se
 * reintenta y se devuelve `ResultadoIncierto`, para que la capa de envío
 * reconcile por Message-ID en vez de reenviar a ciegas.
 *
 * Backoff exponencial con jitter completo, tope de intentos y de espera.
 */

export type Politica = 'lectura' | 'idempotente' | 'no_idempotente'

export class ResultadoIncierto extends Error {
  constructor(readonly causa: string) {
    super(`resultado incierto: ${causa}`)
    this.name = 'ResultadoIncierto'
  }
}

export interface OpcionesReintento {
  intentos: number
  baseMs: number
  topeMs: number
  azar: () => number
  dormir: (ms: number) => Promise<void>
}

export const REINTENTOS_POR_DEFECTO: OpcionesReintento = {
  intentos: 4,
  baseMs: 400,
  topeMs: 8_000,
  azar: Math.random,
  dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
}

/** Espera del intento `n` (0, 1, 2…): jitter completo sobre base·2ⁿ, con tope. */
export function espera(n: number, o: Pick<OpcionesReintento, 'baseMs' | 'topeMs' | 'azar'>, retryAfterS?: number | null): number {
  if (retryAfterS && retryAfterS > 0) return Math.min(retryAfterS * 1000, o.topeMs)
  return Math.floor(o.azar() * Math.min(o.topeMs, o.baseMs * 2 ** n))
}

export interface RespuestaCruda {
  status: number
  retryAfter: number | null
}

/**
 * Corre `intento` según la política. `intento` devuelve la respuesta si fue OK o
 * lanza: `{ status }` para HTTP, cualquier otra cosa para red/timeout.
 */
export async function conReintentos<T>(
  politica: Politica,
  intento: () => Promise<T>,
  clasificar: (e: unknown) => RespuestaCruda | null,
  o: OpcionesReintento = REINTENTOS_POR_DEFECTO,
): Promise<T> {
  let ultimo: unknown
  for (let n = 0; n < o.intentos; n++) {
    try {
      return await intento()
    } catch (e) {
      ultimo = e
      const http = clasificar(e)
      const ultimaVuelta = n === o.intentos - 1

      if (http && http.status === 429) {
        if (ultimaVuelta) throw e
        await o.dormir(espera(n, o, http.retryAfter))
        continue
      }

      const incierto = !http || http.status >= 500 || http.status === 408
      if (!incierto) throw e // 4xx definitivo: no se reintenta en ninguna política

      if (politica === 'no_idempotente') {
        throw new ResultadoIncierto(http ? `HTTP ${http.status}` : (e as Error).name || 'red')
      }
      if (ultimaVuelta) throw e
      await o.dormir(espera(n, o, http?.retryAfter ?? null))
    }
  }
  throw ultimo
}
