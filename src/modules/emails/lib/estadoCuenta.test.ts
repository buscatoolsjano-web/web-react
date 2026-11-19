import { describe, expect, it } from 'vitest'
import { perdioElAcceso } from './estadoCuenta'

describe('perdioElAcceso', () => {
  it('reconoce el permiso vencido o revocado de Google', () => {
    // El error real que tenía Torquetools desde el 2 de noviembre.
    expect(perdioElAcceso('token endpoint (refresh): HTTP 400 {\n  "error": "invalid_grant",\n  "error_description": "Bad Request"\n}')).toBe(true)
    expect(perdioElAcceso('unauthorized_client')).toBe(true)
  })

  it('un error pasajero de sincronización no es pérdida de acceso', () => {
    expect(perdioElAcceso('HTTP 503 backend error')).toBe(false)
    expect(perdioElAcceso(null)).toBe(false)
  })
})
