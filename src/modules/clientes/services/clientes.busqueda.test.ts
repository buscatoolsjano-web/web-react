import { describe, expect, it, vi } from 'vitest'

// `normalizarBusqueda` es una función pura, pero vive en el módulo del
// servicio, que importa el cliente de Supabase y con él `getEnv()`. Sin este
// mock el test exige variables de entorno y se cae en la suite aislada —y en
// CI, que tampoco las tiene—. Es el bug del ADR-019, otra vez.
vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

const { normalizarBusqueda } = await import('./clientes')

/**
 * La normalización del texto de búsqueda.
 *
 * Tiene que dar **exactamente** lo mismo que la columna generada
 * `customers.search_text`, que la base calcula con
 * `translate(lower(...), 'áéíóúüñ', 'aeiouun')`. Si acá y allá se normalizara
 * distinto, la búsqueda no encontraría lo que está guardado — y el fallo sería
 * silencioso: no hay error, simplemente faltan clientes.
 *
 * Los casos salen de nombres reales del maestro.
 */

describe('El texto que se busca se normaliza como en la base', () => {
  it('pasa a minúsculas', () => {
    expect(normalizarBusqueda('WHIRLPOOL')).toBe('whirlpool')
  })

  it('saca las tildes del castellano', () => {
    expect(normalizarBusqueda('Metalúrgica')).toBe('metalurgica')
    expect(normalizarBusqueda('Iluminación')).toBe('iluminacion')
    expect(normalizarBusqueda('Raízen')).toBe('raizen')
    expect(normalizarBusqueda('Rubén')).toBe('ruben')
    expect(normalizarBusqueda('Ferretería')).toBe('ferreteria')
    expect(normalizarBusqueda('TecnoAutomación')).toBe('tecnoautomacion')
  })

  it('la ñ también: «Peña» se encuentra escribiendo «pena»', () => {
    expect(normalizarBusqueda('Peña')).toBe('pena')
    expect(normalizarBusqueda('Niño')).toBe('nino')
  })

  it('la diéresis', () => {
    expect(normalizarBusqueda('Güemes')).toBe('guemes')
  })

  it('y escribirlo YA sin tilde da lo mismo', () => {
    expect(normalizarBusqueda('metalurgica')).toBe(normalizarBusqueda('metalúrgica'))
    expect(normalizarBusqueda('RAIZEN')).toBe(normalizarBusqueda('Raízen'))
  })

  it('saca los espacios de los bordes', () => {
    expect(normalizarBusqueda('  mirgor  ')).toBe('mirgor')
  })

  /**
   * PostgREST separa las condiciones de un `or` con comas, y el texto va
   * adentro: una coma sin sacar rompe la consulta entera, no sólo el filtro.
   */
  it('quita los caracteres que romperían la consulta', () => {
    expect(normalizarBusqueda('acme, s.a.')).toBe('acme s.a.')
    expect(normalizarBusqueda('acme (sa)')).toBe('acme sa')
    expect(normalizarBusqueda('a*b')).toBe('ab')
  })

  it('un texto vacío o sólo espacios no busca nada', () => {
    expect(normalizarBusqueda('')).toBe('')
    expect(normalizarBusqueda('   ')).toBe('')
  })

  it('conserva los dígitos del CUIT', () => {
    expect(normalizarBusqueda('30-71234567-1')).toBe('30-71234567-1')
  })
})
