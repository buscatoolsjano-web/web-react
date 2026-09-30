import { describe, it, expect } from 'vitest'
import { parseEnv } from './env'

const valido = {
  VITE_SUPABASE_URL: 'https://uaxcfufvapzulqvynanp.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_rw9cMuxu6rPtLGyubr5Qog_qrX0VzjY',
}

describe('parseEnv', () => {
  it('acepta una configuración válida', () => {
    expect(parseEnv(valido)).toEqual(valido)
  })

  it('ignora variables extra sin romper', () => {
    expect(parseEnv({ ...valido, MODE: 'test', DEV: true })).toEqual(valido)
  })

  it('rechaza una URL inválida', () => {
    expect(() => parseEnv({ ...valido, VITE_SUPABASE_URL: 'no-es-url' })).toThrow(
      /URL válida/,
    )
  })

  it('rechaza una clave demasiado corta', () => {
    expect(() => parseEnv({ ...valido, VITE_SUPABASE_ANON_KEY: 'corta' })).toThrow(
      /incompleta/,
    )
  })

  it('rechaza entorno vacío y nombra las dos variables faltantes', () => {
    expect(() => parseEnv({})).toThrow(/VITE_SUPABASE_URL/)
    expect(() => parseEnv({})).toThrow(/VITE_SUPABASE_ANON_KEY/)
  })

  /**
   * Una bandeja sin configurar no puede impedir el login.
   *
   * `VITE_EMAILS_API_URL=` en un .env, o un secret de CI en blanco, llega como
   * `''`. Antes zod lo rechazaba por no ser una URL y se caía el arranque
   * entero: nadie podía entrar al ERP porque faltaba una función opcional.
   */
  it('trata la URL de correo vacía como ausente, sin romper el arranque', () => {
    expect(parseEnv({ ...valido, VITE_EMAILS_API_URL: '' })).toEqual(valido)
  })

  it('pero una URL de correo con basura sigue siendo un error', () => {
    expect(() => parseEnv({ ...valido, VITE_EMAILS_API_URL: 'no-es-url' })).toThrow(
      /URL válida/,
    )
  })

  it('y una válida se conserva', () => {
    const con = { ...valido, VITE_EMAILS_API_URL: 'https://api.example.com' }
    expect(parseEnv(con)).toEqual(con)
  })
})
