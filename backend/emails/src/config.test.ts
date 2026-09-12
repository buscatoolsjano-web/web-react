import { describe, it, expect } from 'vitest'
import { buzonPermitido } from './config.js'

/**
 * El allowlist es la segunda barrera contra la impersonación. La primera es que
 * el `sub` nunca viene del request; ésta cubre el caso en que alguien logre
 * escribir una fila en `email_accounts` con otra dirección del dominio.
 */
describe('allowlist de buzones', () => {
  const permitidos = new Set(['info@buscatools.com.ar'])

  it('deja pasar el buzón configurado', () => {
    expect(buzonPermitido(permitidos, 'info@buscatools.com.ar')).toBe(true)
  })

  it('ignora mayúsculas y espacios: eso no debería abrir ni cerrar un buzón', () => {
    expect(buzonPermitido(permitidos, '  INFO@Buscatools.com.ar ')).toBe(true)
  })

  it('rechaza otro buzón del MISMO dominio', () => {
    // Es el caso que importa: DWD puede técnicamente impersonar todo el
    // dominio. El allowlist es lo que impide que el backend pueda.
    expect(buzonPermitido(permitidos, 'contabilidad@buscatools.com.ar')).toBe(false)
  })

  it('rechaza un buzón de otro dominio', () => {
    expect(buzonPermitido(permitidos, 'alguien@otraempresa.com')).toBe(false)
  })

  it('rechaza vacío, null y undefined', () => {
    expect(buzonPermitido(permitidos, '')).toBe(false)
    expect(buzonPermitido(permitidos, null)).toBe(false)
    expect(buzonPermitido(permitidos, undefined)).toBe(false)
  })
})
