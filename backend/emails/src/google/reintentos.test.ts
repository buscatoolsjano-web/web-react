/**
 * Reintentos: la pregunta es «¿Gmail pudo haberlo hecho igual?».
 */
import { describe, expect, it } from 'vitest'
import { ErrorGmail } from './gmail.js'
import { conReintentos, espera, ResultadoIncierto, type OpcionesReintento, type Politica } from './reintentos.js'

function sinEsperas(esperas: number[]): OpcionesReintento {
  return { intentos: 4, baseMs: 400, topeMs: 8000, azar: () => 1, dormir: async (ms) => void esperas.push(ms) }
}
const clasificar = (e: unknown) => (e instanceof ErrorGmail ? { status: e.status, retryAfter: e.retryAfterS } : null)

async function correr(politica: Politica, fallas: Array<number | 'red'>) {
  let llamadas = 0
  const esperas: number[] = []
  const resultado = await conReintentos(
    politica,
    async () => {
      const f = fallas[llamadas++]
      if (f === undefined) return 'ok'
      if (f === 'red') throw new TypeError('fetch failed')
      throw new ErrorGmail(f, 'x')
    },
    clasificar,
    sinEsperas(esperas),
  ).then((v) => v, (e: unknown) => e)
  return { resultado, llamadas, esperas }
}

describe('política de reintentos', () => {
  it('lectura: reintenta 5xx y red con backoff, hasta el tope', async () => {
    const r = await correr('lectura', [503, 'red', 500])
    expect(r.resultado).toBe('ok')
    expect(r.llamadas).toBe(4)
    expect(r.esperas).toEqual([400, 800, 1600])
  })

  it('lectura: se rinde después del tope y devuelve el último error', async () => {
    const r = await correr('lectura', [503, 503, 503, 503, 503])
    expect(r.resultado).toBeInstanceOf(ErrorGmail)
    expect(r.llamadas).toBe(4)
  })

  it('un 4xx definitivo no se reintenta en ninguna política', async () => {
    for (const p of ['lectura', 'idempotente', 'no_idempotente'] as const) {
      const r = await correr(p, [400])
      expect(r.llamadas).toBe(1)
      expect((r.resultado as ErrorGmail).status).toBe(400)
    }
  })

  it('429 se reintenta SIEMPRE, también un envío: Gmail no lo procesó', async () => {
    const r = await correr('no_idempotente', [429, 429])
    expect(r.resultado).toBe('ok')
    expect(r.llamadas).toBe(3)
  })

  it('NO IDEMPOTENTE: un 5xx es incierto y NO se reintenta', async () => {
    const r = await correr('no_idempotente', [503])
    expect(r.resultado).toBeInstanceOf(ResultadoIncierto)
    expect(r.llamadas).toBe(1)
  })

  it('NO IDEMPOTENTE: un corte de red o timeout es incierto y NO se reintenta', async () => {
    const r = await correr('no_idempotente', ['red'])
    expect(r.resultado).toBeInstanceOf(ResultadoIncierto)
    expect(r.llamadas).toBe(1)
  })

  it('idempotente: un 5xx sí se reintenta', async () => {
    const r = await correr('idempotente', [502])
    expect(r.resultado).toBe('ok')
    expect(r.llamadas).toBe(2)
  })

  it('respeta Retry-After con tope, y el jitter nunca pasa el techo', () => {
    const o = { baseMs: 400, topeMs: 8000, azar: () => 0.999 }
    expect(espera(0, o, 3)).toBe(3000)
    expect(espera(0, o, 60)).toBe(8000)
    expect(espera(10, o)).toBeLessThan(8000)
    expect(espera(2, { ...o, azar: () => 0 })).toBe(0)
  })
})
