import { describe, expect, it } from 'vitest'
import { leerCallbackAuth } from './callbackUrl'
import { traducirErrorContrasena, validarContrasenaNueva } from './contrasena'

describe('leerCallbackAuth', () => {
  const base = 'https://app.buscatools.com/'

  it('una ruta del HashRouter no es un callback', () => {
    expect(leerCallbackAuth(`${base}#/configuracion/usuarios`)).toBeNull()
    expect(leerCallbackAuth(`${base}#/auth/login?next=%2F`)).toBeNull()
    expect(leerCallbackAuth(base)).toBeNull()
  })

  it('invitación con sesión en el fragmento', () => {
    expect(leerCallbackAuth(`${base}#access_token=a.b.c&expires_in=3600&refresh_token=r1&token_type=bearer&type=invite`)).toEqual({
      tipo: 'sesion',
      motivo: 'invite',
      accessToken: 'a.b.c',
      refreshToken: 'r1',
    })
  })

  it('recuperación', () => {
    expect(leerCallbackAuth(`${base}#access_token=x&refresh_token=y&type=recovery`)).toMatchObject({ tipo: 'sesion', motivo: 'recovery' })
  })

  it('un tipo desconocido no se trata como invitación', () => {
    expect(leerCallbackAuth(`${base}#access_token=x&refresh_token=y&type=raro`)).toMatchObject({ motivo: 'otro' })
  })

  it('sin refresh token no hay sesión utilizable', () => {
    expect(leerCallbackAuth(`${base}#access_token=x&type=invite`)).toBeNull()
  })

  it('enlace vencido o inválido', () => {
    expect(leerCallbackAuth(`${base}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid`)).toEqual({ tipo: 'error', codigo: 'otp_expired' })
    expect(leerCallbackAuth(`${base}#error=server_error`)).toEqual({ tipo: 'error', codigo: 'server_error' })
  })

  it('href inválido', () => {
    expect(leerCallbackAuth('no es una url')).toBeNull()
  })
})

describe('validarContrasenaNueva', () => {
  it('largo mínimo, máximo, espacios y confirmación', () => {
    expect(validarContrasenaNueva('corta', 'corta')).toMatch(/al menos 8/)
    expect(validarContrasenaNueva('x'.repeat(73), 'x'.repeat(73))).toMatch(/máximo 72/)
    expect(validarContrasenaNueva(' conespacio1', ' conespacio1')).toMatch(/espacios/)
    expect(validarContrasenaNueva('buenaClave1!', 'otraClave1!')).toMatch(/no coinciden/)
    expect(validarContrasenaNueva('buenaClave1!', 'buenaClave1!')).toBeNull()
  })

  it('cuenta bytes, no caracteres', () => {
    // 25 «ñ» son 50 bytes; 37 son 74.
    expect(validarContrasenaNueva('ñ'.repeat(37), 'ñ'.repeat(37))).toMatch(/máximo/)
  })
})

describe('traducirErrorContrasena', () => {
  it('nunca devuelve el texto crudo', () => {
    expect(traducirErrorContrasena({ code: 'weak_password', message: 'Password should be at least 6 characters' })).toMatch(/débil/)
    expect(traducirErrorContrasena({ code: 'same_password', message: 'x' })).toMatch(/distinta/)
    expect(traducirErrorContrasena({ name: 'AuthSessionMissingError', message: 'Auth session missing!' })).toMatch(/venció/)
    expect(traducirErrorContrasena({ message: 'boom interno' })).toBe('No se pudo guardar la contraseña. Intentá de nuevo.')
  })
})
