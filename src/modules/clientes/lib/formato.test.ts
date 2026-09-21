import { describe, expect, it } from 'vitest'
import { formatearCuit, formatearFecha, formatearImporte, nombreVisible, haceCuanto } from './formato'

describe('formatearImporte', () => {
  it('un total nulo es una raya, nunca un cero', () => {
    expect(formatearImporte(null, 'USD')).toBe('—')
  })

  it('sin moneda muestra el número solo, sin suponer ARS', () => {
    expect(formatearImporte(1234.5, null)).not.toContain('ARS')
    expect(formatearImporte(1234.5, null)).toContain('1.234,50')
  })

  it('con moneda la antepone', () => {
    expect(formatearImporte(1234.5, 'USD')).toBe('USD 1.234,50')
  })
})

describe('formatearFecha', () => {
  it('no se corre un día por la zona horaria', () => {
    expect(formatearFecha('2026-01-01')).toBe('01/01/2026')
  })

  it('acepta un timestamp completo', () => {
    expect(formatearFecha('2026-09-10T00:53:53.270Z')).toBe('10/09/2026')
  })

  it('sin fecha, raya', () => {
    expect(formatearFecha(null)).toBe('—')
  })
})

describe('formatearCuit', () => {
  it('agrupa los once dígitos', () => {
    expect(formatearCuit('30503284410')).toBe('30-50328441-0')
  })

  it('acepta el que ya viene con guiones', () => {
    expect(formatearCuit('30-50287435-3')).toBe('30-50287435-3')
  })

  it('lo que no es un CUIT se muestra tal cual, sin corregirlo', () => {
    expect(formatearCuit('en trámite')).toBe('en trámite')
    expect(formatearCuit('123')).toBe('123')
  })

  it('sin CUIT, raya', () => {
    expect(formatearCuit(null)).toBe('—')
  })
})

describe('nombreVisible', () => {
  it('prefiere el nombre comercial', () => {
    expect(nombreVisible('Acme S.A.', 'Acme')).toBe('Acme')
  })

  it('sin nombre comercial usa la razón social', () => {
    expect(nombreVisible('Acme S.A.', null)).toBe('Acme S.A.')
    expect(nombreVisible('Acme S.A.', '   ')).toBe('Acme S.A.')
  })
})

/**
 * `haceCuanto` (Fase 19 · E7) — la antigüedad de la última actividad.
 *
 * El «hoy» se pasa por parámetro: una función que lea el reloj por dentro no
 * se puede probar sin congelarlo, y congelar el reloj rompe los `findBy*` de
 * los tests de componentes.
 */
describe('haceCuanto', () => {
  const hoy = new Date(2026, 8, 21) // 21/09/2026, hora local

  it('los primeros días se dicen con palabras', () => {
    expect(haceCuanto('2026-09-21', hoy)).toBe('Hoy')
    expect(haceCuanto('2026-09-20', hoy)).toBe('Ayer')
    expect(haceCuanto('2026-09-07', hoy)).toBe('Hace 14 días')
  })

  it('pasado el mes se cuenta en meses: «hace 340 días» no se entiende', () => {
    expect(haceCuanto('2026-08-01', hoy)).toBe('Hace 2 meses')
    expect(haceCuanto('2026-07-23', hoy)).toBe('Hace 2 meses')
    expect(haceCuanto('2025-11-21', hoy)).toBe('Hace 10 meses')
  })

  it('más de un año se redondea hacia abajo, sin prometer precisión', () => {
    expect(haceCuanto('2024-06-15', hoy)).toBe('Hace más de 2 años')
  })

  /** Una cotización cargada con fecha de mañana existe, y «hace −1 días» no. */
  it('una fecha futura se dice, no se calcula', () => {
    expect(haceCuanto('2026-09-30', hoy)).toBe('Con fecha futura')
  })

  it('sin fecha no hay antigüedad que mostrar', () => {
    expect(haceCuanto(null, hoy)).toBeNull()
    expect(haceCuanto('', hoy)).toBeNull()
  })
})
