import { describe, expect, it } from 'vitest'
import { estaEnLinea, ultimaConexionTexto } from './presencia'

const AHORA = new Date('2026-10-23T15:00:00')

describe('ultimaConexionTexto (Fase 145)', () => {
  it('sin dato no muestra nada', () => {
    expect(ultimaConexionTexto(null, AHORA)).toBe('')
    expect(ultimaConexionTexto('no-es-fecha', AHORA)).toBe('')
  })

  it('reciente (menos de 5 min) es «en línea»', () => {
    expect(ultimaConexionTexto('2026-10-23T14:58:00', AHORA)).toBe('en línea')
    expect(estaEnLinea('2026-10-23T14:58:00', AHORA)).toBe(true)
  })

  it('hoy pero hace rato, dice la hora', () => {
    expect(ultimaConexionTexto('2026-10-23T09:30:00', AHORA)).toMatch(/^últ\. vez hoy a las /)
    expect(estaEnLinea('2026-10-23T09:30:00', AHORA)).toBe(false)
  })

  it('ayer lo dice', () => {
    expect(ultimaConexionTexto('2026-10-22T20:00:00', AHORA)).toMatch(/^últ\. vez ayer a las /)
  })

  it('antes de ayer, la fecha', () => {
    expect(ultimaConexionTexto('2026-10-10T20:00:00', AHORA)).toMatch(/^últ\. vez el /)
  })
})
