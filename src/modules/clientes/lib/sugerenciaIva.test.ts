import { describe, expect, it } from 'vitest'
import { sugerirCondicionIva } from './sugerenciaIva'

describe('sugerirCondicionIva', () => {
  it('una sociedad (30, 33, 34) se sugiere Responsable Inscripto', () => {
    expect(sugerirCondicionIva('30-71234567-8')).toBe('responsable_inscripto')
    expect(sugerirCondicionIva('33712345679')).toBe('responsable_inscripto')
  })

  it('una persona humana o sin CUIT no se sugiere: el CUIT no lo dice', () => {
    expect(sugerirCondicionIva('20-12345678-9')).toBeNull()
    expect(sugerirCondicionIva('27123456789')).toBeNull()
    expect(sugerirCondicionIva(null)).toBeNull()
    expect(sugerirCondicionIva('00000000')).toBeNull()
  })
})
