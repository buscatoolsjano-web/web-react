import { describe, expect, it } from 'vitest'
import { fechaCorta, fechaLarga, formatearImporte } from './formato'

describe('las fechas de la planilla', () => {
  /*
   * El día TIENE que ser el 5. `new Date('2026-10-05')` es medianoche UTC, que
   * en Argentina son las 21:00 del 4: sin el mediodía la columna mostraría el
   * día anterior, y una columna fechada un día antes de la lista que representa
   * es un dato equivocado.
   */
  it('no se corren un día por el huso horario', () => {
    expect(fechaCorta('2026-10-05')).toContain('05')
    expect(fechaLarga('2026-10-05')).toBe('5 de octubre de 2026')
  })

  it('la corta entra en un encabezado angosto', () => {
    expect(fechaCorta('2026-10-05').length).toBeLessThanOrEqual(12)
  })

  it('aceptan un timestamp y se quedan con la fecha', () => {
    expect(fechaLarga('2026-10-05T03:00:00Z')).toBe(fechaLarga('2026-10-05'))
  })

  it('una fecha que no es fecha se devuelve tal cual, no inventa una', () => {
    expect(fechaLarga('ayer')).toBe('ayer')
    expect(fechaLarga('2026-13-45')).toBe('2026-13-45')
  })
})

describe('los importes de la planilla', () => {
  it('van con dos decimales', () => {
    expect(formatearImporte(13.5)).toBe('13,50')
    expect(formatearImporte(2170)).toBe('2.170,00')
  })

  /* Null y no cero: un cero diría que vale cero, que es otra afirmación. */
  it('sin dato es una raya, no un cero', () => {
    expect(formatearImporte(null)).toBe('—')
    expect(formatearImporte(undefined)).toBe('—')
    expect(formatearImporte(Number.NaN)).toBe('—')
    expect(formatearImporte(Number.POSITIVE_INFINITY)).toBe('—')
  })

  /*
   * SIN símbolo de moneda, a propósito. En esta pantalla conviven EUR —el costo
   * de las listas— y USD o ARS —lo vendido—, y la moneda se escribe aparte para
   * que no se pueda perder al lado del número.
   */
  it('no mete el símbolo de la moneda', () => {
    expect(formatearImporte(146.79, 'USD')).toBe('146,79')
    expect(formatearImporte(146.79, 'EUR')).toBe('146,79')
  })

  it('el cero es un dato y se muestra', () => {
    expect(formatearImporte(0)).toBe('0,00')
  })
})
