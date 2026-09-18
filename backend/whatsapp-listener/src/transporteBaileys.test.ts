import { describe, expect, it } from 'vitest'
import { motivoDeCierre } from './transporteBaileys.js'
import { debeReintentar } from './reconexion.js'

/**
 * Del error de Baileys al motivo, y del motivo a la decisión.
 *
 * Es la única parte del adaptador que se puede probar sin sesión, y es la que
 * decide si el listener reintenta o para. Equivocarse acá, con un cliente no
 * oficial, cuesta el número.
 */

/** Un `Boom` como el que manda la librería, sin importar `@hapi/boom`. */
const boom = (statusCode: number) => ({ output: { statusCode }, message: 'Connection Failure' })

describe('Por qué se cortó', () => {
  it('traduce el código al nombre de la librería', () => {
    expect(motivoDeCierre(boom(401))).toBe('loggedOut (401)')
    expect(motivoDeCierre(boom(515))).toBe('restartRequired (515)')
    expect(motivoDeCierre(boom(440))).toBe('connectionReplaced (440)')
    expect(motivoDeCierre(boom(428))).toBe('connectionClosed (428)')
  })

  it('un código que la librería no nombra igual se reporta', () => {
    expect(motivoDeCierre(boom(499))).toBe('codigo_499')
  })

  it('un error sin código se sanea', () => {
    expect(motivoDeCierre(new Error('ECONNRESET en 5491121866133'))).toContain('<numero>')
  })

  it('y no revienta con null', () => {
    expect(typeof motivoDeCierre(null)).toBe('string')
    expect(typeof motivoDeCierre(undefined)).toBe('string')
  })
})

describe('Y qué se hace con ese motivo', () => {
  it('desvinculado, reemplazado o bloqueado: NO se reintenta', () => {
    for (const codigo of [401, 403, 440, 411, 500]) {
      expect(debeReintentar(motivoDeCierre(boom(codigo))), String(codigo)).toBe(false)
    }
  })

  it('reinicio pedido y caídas de red: se reintenta', () => {
    for (const codigo of [515, 428, 408, 503]) {
      expect(debeReintentar(motivoDeCierre(boom(codigo))), String(codigo)).toBe(true)
    }
  })

  it('el 515 de después de vincular es el caso que NO hay que confundir', () => {
    // Apenas se escanea el QR, WhatsApp cierra con 515 y hay que reconectar.
    // Tratarlo como definitivo dejaría el listener muerto justo al vincularlo.
    expect(debeReintentar(motivoDeCierre(boom(515)))).toBe(true)
  })
})
