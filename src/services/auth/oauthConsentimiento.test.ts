import { describe, expect, it, vi } from 'vitest'

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

const { alcancesDe, idDeLaUrl } = await import('./oauthConsentimiento')

/**
 * Las dos funciones puras del servicio. Son chicas y aburridas, y son
 * exactamente donde se pierde media hora cuando el consentimiento «no
 * arranca»: el id llega de una forma que nadie previó y la pantalla dice que
 * no hay nada que aprobar.
 */
describe('de dónde se saca el authorization_id', () => {
  /* La app usa router de hash: así se ve la URL cuando Supabase manda al hash. */
  it('lo encuentra adentro del hash', () => {
    expect(idDeLaUrl('https://app.buscatools.com/#/oauth/consent?authorization_id=abc')).toBe('abc')
  })

  /* Y así cuando la ruta se configuró lisa y entró el fallback de 404.html. */
  it('lo encuentra en el query de verdad', () => {
    expect(idDeLaUrl('https://app.buscatools.com/oauth/consent?authorization_id=abc')).toBe('abc')
  })

  it('el query de verdad gana, porque es el que manda el servidor', () => {
    const url = 'https://app.buscatools.com/oauth/consent?authorization_id=real#/x?authorization_id=viejo'
    expect(idDeLaUrl(url)).toBe('real')
  })

  it('con otros parámetros alrededor sigue encontrándolo', () => {
    expect(
      idDeLaUrl('https://app.buscatools.com/#/oauth/consent?state=xx&authorization_id=abc&otro=1'),
    ).toBe('abc')
  })

  it('sin id devuelve null, no cadena vacía', () => {
    expect(idDeLaUrl('https://app.buscatools.com/#/oauth/consent')).toBeNull()
    expect(idDeLaUrl('https://app.buscatools.com/')).toBeNull()
    // Vacío es lo mismo que ausente: con un id vacío no se puede pedir nada.
    expect(idDeLaUrl('https://app.buscatools.com/#/oauth/consent?authorization_id=')).toBeNull()
  })

  it('una URL que no es URL no revienta', () => {
    expect(idDeLaUrl('no soy una url')).toBeNull()
    expect(idDeLaUrl('')).toBeNull()
  })
})

describe('los alcances', () => {
  it('vienen separados por espacios', () => {
    expect(alcancesDe('openid profile erp')).toEqual(['openid', 'profile', 'erp'])
  })

  /* Sin esto, `''.split(' ')` da `['']` y la pantalla pinta un permiso vacío. */
  it('vacío es ninguno, no uno vacío', () => {
    expect(alcancesDe('')).toEqual([])
    expect(alcancesDe('   ')).toEqual([])
  })

  it('aguanta espacios de más', () => {
    expect(alcancesDe('  erp   openid ')).toEqual(['erp', 'openid'])
  })
})
