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
})
