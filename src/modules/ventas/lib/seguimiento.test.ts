import { describe, expect, it } from 'vitest'
import { estadoContacto, etiquetaMotivo, sumarDias } from './seguimiento'

describe('seguimiento de cotizaciones', () => {
  it('suma días cruzando meses y años', () => {
    expect(sumarDias('2026-11-26', 15)).toBe('2026-12-11')
    expect(sumarDias('2026-12-25', 10)).toBe('2027-01-04')
  })

  it('dice si el próximo contacto está atrasado, es hoy o viene', () => {
    expect(estadoContacto('2026-11-20', '2026-11-26')).toBe('atrasado')
    expect(estadoContacto('2026-11-26', '2026-11-26')).toBe('hoy')
    expect(estadoContacto('2026-12-01', '2026-11-26')).toBe('proximo')
    expect(estadoContacto(null, '2026-11-26')).toBeNull()
  })

  it('nombra los motivos de pérdida', () => {
    expect(etiquetaMotivo('precio')).toBe('Precio')
    expect(etiquetaMotivo(null)).toBeNull()
  })
})
