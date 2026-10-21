import { describe, expect, it } from 'vitest'
import { palabrasClaveDe, sinonimosDe, tambienBuscadoComo } from './sinonimos'

/**
 * El diccionario de sinónimos (Fase 88 · SEO).
 *
 * Lo que se prueba es la REGLA, no cada palabra: que los sinónimos sean otros
 * nombres de la cosa y no cebo, que no se repitan, y que un producto sin
 * término conocido no invente nada.
 */
describe('sinonimosDe', () => {
  it('«embocadura» trae los nombres de la calle', () => {
    // El caso que pidió el usuario: muchos la buscan como «tubo» o «dado».
    const s = sinonimosDe('Embocadura')
    expect(s).toContain('tubo')
    expect(s).toContain('dado')
    expect(s).toContain('boca de llave')
  })

  it('no le importan los acentos ni las mayúsculas', () => {
    expect(sinonimosDe('CARDÁNICO')).toEqual(sinonimosDe('cardanico'))
  })

  it('un término que no está en el diccionario no inventa nada', () => {
    expect(sinonimosDe('SP.J2310H')).toEqual([])
    expect(sinonimosDe(null)).toEqual([])
    expect(sinonimosDe('')).toEqual([])
  })

  it('ningún sinónimo es cebo: todos son nombres de la cosa', () => {
    // La línea que no se cruza. Si aparece «barato», «oferta», «comprar» o
    // «precio» en el diccionario, es keyword stuffing y Google lo castiga.
    const cebo = ['barato', 'oferta', 'comprar', 'precio', 'mejor', 'descuento', 'gratis']
    for (const t of ['Embocadura', 'Punta', 'Balanceador', 'Torx', 'Phillips']) {
      for (const s of sinonimosDe(t)) {
        expect(cebo, `«${s}» en ${t}`).not.toContain(s.toLowerCase())
      }
    }
  })
})

describe('palabrasClaveDe', () => {
  it('junta tipo, serie y categoría sin repetir', () => {
    const claves = palabrasClaveDe({
      categoria: 'Puntas y tubos',
      serie: 'Embocadura',
      tipo: 'Embocadura',
    })
    // «embocadura» aparece en serie Y tipo: sus sinónimos no se duplican.
    expect(claves.filter((c) => c === 'tubo')).toHaveLength(1)
    expect(claves).toContain('dado')
  })

  it('el tipo manda: sus sinónimos van primero', () => {
    const claves = palabrasClaveDe({ categoria: 'Puntas y tubos', tipo: 'Torx', serie: null })
    expect(claves[0]).toBe('estrella')
  })

  it('un producto sin términos conocidos no tiene palabras clave', () => {
    expect(palabrasClaveDe({ categoria: null, serie: null, tipo: null })).toEqual([])
  })
})

describe('tambienBuscadoComo', () => {
  it('arma una frase legible y verdadera', () => {
    const f = tambienBuscadoComo({ categoria: 'Puntas y tubos', serie: 'Embocadura', tipo: 'Embocadura' })
    expect(f).toMatch(/^También buscado como: /)
    expect(f).toContain('tubo')
    expect(f.endsWith('.')).toBe(true)
  })

  it('sin sinónimos, no escribe el rótulo vacío', () => {
    expect(tambienBuscadoComo({ categoria: null, serie: null, tipo: null })).toBe('')
  })
})
