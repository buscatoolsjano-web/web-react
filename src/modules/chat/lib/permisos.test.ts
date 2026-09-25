import { describe, expect, it } from 'vitest'
import { ROLES_CHAT, puedeUsarChat } from './permisos'

describe('quién usa el chat interno', () => {
  /**
   * El conjunto «de adentro», el mismo de
   * `app.current_internal_company_ids()`. Que coincida no es casualidad: si
   * alguna vez divergen, la pantalla ofrecería un chat que la base rechaza.
   */
  it.each([
    ['admin', true],
    ['employee', true],
    ['salesperson', true],
    ['technician', true],
    ['customer', false],
    ['distributor', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('rol «%s» → %s', (rol, esperado) => {
    expect(puedeUsarChat(rol)).toBe(esperado)
  })

  it('no deja entrar a nadie de afuera', () => {
    expect(ROLES_CHAT).not.toContain('customer')
    expect(ROLES_CHAT).not.toContain('distributor')
  })
})
