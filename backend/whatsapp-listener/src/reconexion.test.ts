import { describe, expect, it } from 'vitest'
import { ESPERA_MAXIMA_MS, debeReintentar, esperaDeReintento } from './reconexion.js'

/**
 * El backoff.
 *
 * Importa más de lo que parece: con un cliente **no oficial**, reintentar
 * agresivamente contra un servidor que ya está rechazando la conexión es la
 * forma más rápida de que el número quede marcado. Por eso se prueba que crezca,
 * que tenga techo, y sobre todo que NO reintente cuando la sesión se cerró.
 */

describe('Cuánto esperar antes de reintentar', () => {
  it('crece con cada intento', () => {
    const sinRuido = () => 0.5
    expect(esperaDeReintento(1, sinRuido)).toBe(5_000)
    expect(esperaDeReintento(2, sinRuido)).toBe(10_000)
    expect(esperaDeReintento(3, sinRuido)).toBe(20_000)
    expect(esperaDeReintento(4, sinRuido)).toBe(40_000)
  })

  it('tiene techo: nunca se va a horas', () => {
    const sinRuido = () => 0.5
    expect(esperaDeReintento(20, sinRuido)).toBe(ESPERA_MAXIMA_MS)
    expect(esperaDeReintento(100, sinRuido)).toBe(ESPERA_MAXIMA_MS)
  })

  it('el ruido separa a dos instancias que se cayeron juntas', () => {
    const temprano = esperaDeReintento(3, () => 0)
    const tarde = esperaDeReintento(3, () => 1)
    expect(temprano).toBeLessThan(tarde)
    // ±20 % sobre 20 s.
    expect(temprano).toBeGreaterThanOrEqual(16_000)
    expect(tarde).toBeLessThanOrEqual(24_000)
  })

  it('el ruido nunca hace pasar el techo', () => {
    expect(esperaDeReintento(50, () => 1)).toBeLessThanOrEqual(ESPERA_MAXIMA_MS)
  })

  it('un intento raro no rompe el cálculo', () => {
    expect(esperaDeReintento(0, () => 0.5)).toBe(5_000)
    expect(esperaDeReintento(-3, () => 0.5)).toBe(5_000)
  })
})

describe('Cuándo NO hay que reintentar', () => {
  it('una caída de red se reintenta', () => {
    for (const motivo of ['network', 'ECONNRESET', 'timeout', 'stream errored', 'restart required']) {
      expect(debeReintentar(motivo)).toBe(true)
    }
  })

  it('una sesión cerrada NO se reintenta: hay que vincular de nuevo', () => {
    for (const motivo of ['logged_out', 'DisconnectReason.loggedOut', '401 unauthorized', 'sesion_invalida', 'account banned']) {
      expect(debeReintentar(motivo)).toBe(false)
    }
  })

  /**
   * Los códigos reales de `DisconnectReason` de Baileys. Se prueban por
   * nombre y por número porque el motivo llega de las dos formas según por
   * dónde pase.
   */
  it('los motivos definitivos de la librería tampoco se reintentan', () => {
    for (const motivo of [
      'loggedOut', '401',
      'forbidden', '403',
      'connectionReplaced', '440',
      'multideviceMismatch', '411',
      'badSession', '500',
    ]) {
      expect(debeReintentar(motivo), motivo).toBe(false)
    }
  })

  it('«restartRequired» SÍ se reintenta: es lo normal justo después de vincular', () => {
    expect(debeReintentar('restartRequired')).toBe(true)
    expect(debeReintentar('515')).toBe(true)
  })

  it('y las caídas pasajeras de la librería también', () => {
    for (const motivo of ['connectionClosed', '428', 'connectionLost', '408', 'timedOut', 'unavailableService', '503']) {
      expect(debeReintentar(motivo), motivo).toBe(true)
    }
  })
})
