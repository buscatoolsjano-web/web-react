import { describe, expect, it } from 'vitest'
import { elegirVoz, type VozPosible } from './voz'

/**
 * Qué voz se elige (Fase 85).
 *
 * La lista de voces de cada máquina es distinta y no hay forma de verlas todas
 * a mano: esto es lo único que se puede probar de la voz, y es lo único que
 * importa, porque elegir mal se escucha.
 */
const v = (lang: string, name = lang): VozPosible => ({ lang, name })

describe('elegirVoz', () => {
  it('sin ninguna en castellano, ninguna', () => {
    expect(elegirVoz([v('en-US'), v('pt-BR')])).toBeNull()
    expect(elegirVoz([])).toBeNull()
  })

  it('la argentina gana a todas', () => {
    const elegida = elegirVoz([v('es-ES'), v('en-US'), v('es-MX'), v('es-AR')])
    expect(elegida?.lang).toBe('es-AR')
  })

  it('sin argentina, cualquier latinoamericana antes que la de España', () => {
    // La de España dice «vosotros tenéis» con la zeta: hace ruido antes de que
    // se entienda lo que dijo.
    expect(elegirVoz([v('es-ES'), v('es-MX')])?.lang).toBe('es-MX')
    expect(elegirVoz([v('es-ES'), v('es-419')])?.lang).toBe('es-419')
  })

  it('España sólo si no hay otra', () => {
    expect(elegirVoz([v('es-ES'), v('en-GB')])?.lang).toBe('es-ES')
  })

  it('un «es» pelado sirve, y antes que España', () => {
    expect(elegirVoz([v('es-ES'), v('es')])?.lang).toBe('es')
  })

  it('no le importan las mayúsculas, que las hay según el sistema', () => {
    expect(elegirVoz([v('ES-AR')])?.lang).toBe('ES-AR')
  })

  it('devuelve la voz entera, con su nombre, que es con lo que se la pide', () => {
    expect(elegirVoz([v('es-AR', 'Microsoft Elena')])).toEqual({
      lang: 'es-AR',
      name: 'Microsoft Elena',
    })
  })

  it('no confunde un idioma que empieza igual', () => {
    // No hay ninguno que empiece con «es» además del castellano, pero el día
    // que aparezca —`est` para estonio es ISO 639-2— no tiene que entrar.
    expect(elegirVoz([v('et-EE'), v('eo')])).toBeNull()
  })
})
