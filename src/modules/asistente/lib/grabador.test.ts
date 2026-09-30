// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { empezarAGrabar, FalloGrabacion, sePuedeGrabar } from './grabador'

/**
 * El grabador (Fase 36 · E2).
 *
 * Lo que se prueba es lo que se olvida siempre y en un micrófono se nota: que
 * el micrófono se SUELTE al terminar y también al cancelar, y que «dijiste que
 * no» se distinga de «no hay micrófono», porque se resuelven distinto.
 */

/** Un `MediaRecorder` de mentira, con su `isTypeSupported`. */
function fingirNavegador(opciones: {
  formatos?: string[]
  alPedirMicrofono?: () => Promise<unknown>
} = {}) {
  const detenidas: string[] = []
  const pistas = [
    { kind: 'audio', stop: () => detenidas.push('a') },
    { kind: 'audio', stop: () => detenidas.push('b') },
  ]

  class RecFalso {
    state = 'recording'
    ondataavailable: ((e: { data: Blob }) => void) | null = null
    onstop: (() => void) | null = null
    start() {
      this.ondataavailable?.({ data: new Blob(['hola'], { type: 'audio/webm' }) })
    }
    stop() {
      this.state = 'inactive'
      this.onstop?.()
    }
    static isTypeSupported(f: string) {
      return (opciones.formatos ?? ['audio/webm;codecs=opus']).includes(f)
    }
  }

  vi.stubGlobal('MediaRecorder', RecFalso)
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia:
        opciones.alPedirMicrofono ?? (() => Promise.resolve({ getTracks: () => pistas })),
    },
  })
  return { detenidas }
}

afterEach(() => vi.unstubAllGlobals())

describe('El grabador', () => {
  it('no se ofrece si el navegador no puede grabar', () => {
    vi.stubGlobal('navigator', {})
    expect(sePuedeGrabar()).toBe(false)
  })

  it('tampoco si no soporta ninguno de los formatos que usamos', () => {
    fingirNavegador({ formatos: [] })
    expect(sePuedeGrabar()).toBe(false)
  })

  it('se ofrece cuando hay micrófono y un formato soportado', () => {
    fingirNavegador()
    expect(sePuedeGrabar()).toBe(true)
  })

  /**
   * Lo más importante: si las pistas no se paran, el navegador deja el
   * indicador de «grabando» prendido para siempre y algunos sistemas no lo
   * liberan hasta cerrar la pestaña.
   */
  it('al terminar devuelve el audio Y suelta el micrófono', async () => {
    const { detenidas } = fingirNavegador()
    const g = await empezarAGrabar()
    const audio = await g.detener()

    expect(audio.size).toBeGreaterThan(0)
    expect(detenidas, 'quedó el micrófono tomado').toEqual(['a', 'b'])
  })

  it('al cancelar también lo suelta', async () => {
    const { detenidas } = fingirNavegador()
    const g = await empezarAGrabar()
    g.cancelar()
    expect(detenidas).toEqual(['a', 'b'])
  })

  /** «Dijiste que no» y «no hay micrófono» no se arreglan igual. */
  it('distingue el permiso denegado de la falta de micrófono', async () => {
    fingirNavegador({
      alPedirMicrofono: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })),
    })
    await expect(empezarAGrabar()).rejects.toMatchObject({ motivo: 'sin_permiso' })

    fingirNavegador({
      alPedirMicrofono: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotFoundError' })),
    })
    await expect(empezarAGrabar()).rejects.toMatchObject({ motivo: 'sin_microfono' })
  })

  it('un fallo desconocido no se disfraza de permiso denegado', async () => {
    fingirNavegador({ alPedirMicrofono: () => Promise.reject(new Error('vaya a saber')) })
    await expect(empezarAGrabar()).rejects.toBeInstanceOf(FalloGrabacion)
    await expect(empezarAGrabar()).rejects.toMatchObject({ motivo: 'error' })
  })
})
