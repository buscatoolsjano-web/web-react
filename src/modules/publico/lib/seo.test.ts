import { describe, expect, it } from 'vitest'
import {
  datosEstructurados,
  descripcionDeCategoria,
  descripcionDeProducto,
  LARGO_DESCRIPCION,
  LARGO_TITULO,
  nombreDeAtributo,
  rasgosLegibles,
  recortar,
  tituloDeCategoria,
  tituloDeProducto,
  valorLegible,
} from './seo'

/**
 * Lo que leen los buscadores (Fase 87 · E2).
 *
 * Son pruebas de LARGO y de CONTENIDO, no de redacción: un título que pasa
 * de sesenta caracteres no se ve feo, se corta; y nueve mil descripciones
 * iguales le dicen al buscador que el sitio tiene una sola página repetida.
 */
const PH2 = {
  nombre: 'SPEEDRILL PH2 PHILLIPS',
  sku: 'SP.PH2',
  marca: 'SPEEDRILL',
  categoria: 'Puntas y tubos',
  descripcion: 'Punta Phillips SPEEDRILL PH2. La más usada para montaje general.',
  atributos: { largo: '25', medida: '2', encastre: '1/4 HEX BIT' },
}

describe('recortar', () => {
  it('no toca lo que ya entra', () => {
    expect(recortar('corto', 60)).toBe('corto')
  })

  it('no parte una palabra al medio', () => {
    // Cortar en seco deja «durabil», que se lee como un error.
    const r = recortar('Embocadura SPEEDRILL J2310H, calidad y durabilidad garantizadas', 48)
    expect(r.length).toBeLessThanOrEqual(48)
    expect(r.endsWith('durabil')).toBe(false)
    expect(r.split(' ').at(-1)).not.toBe('durabil')
  })

  it('normaliza los espacios y los saltos', () => {
    expect(recortar('  uno\n\n  dos  ', 60)).toBe('uno dos')
  })

  it('con una palabra sola más larga que el tope, corta igual', () => {
    // Si no, devolvería vacío y la página quedaría sin título.
    expect(recortar('A'.repeat(80), 20)).toHaveLength(20)
  })
})

describe('el título de una ficha', () => {
  it('entra en lo que muestra el buscador', () => {
    expect(tituloDeProducto(PH2).length).toBeLessThanOrEqual(LARGO_TITULO)
  })

  it('pone el producto adelante y la casa al final', () => {
    // Si el buscador corta, que corte por «Buscatools» y no por el SKU.
    const t = tituloDeProducto(PH2)
    expect(t.indexOf('SPEEDRILL')).toBeLessThan(t.indexOf('Buscatools'))
    expect(t.endsWith('| Buscatools')).toBe(true)
  })

  it('un nombre larguísimo no empuja el nombre de la casa afuera', () => {
    const t = tituloDeProducto({ nombre: 'BROPPE PUNTA PHILLIPS S2 ENCASTRE HEXAGONAL DIAMETRO 4.0mm PH2 LARGO 100mm', sku: 'BR.PH2' })
    expect(t.length).toBeLessThanOrEqual(LARGO_TITULO)
    expect(t.endsWith('| Buscatools')).toBe(true)
  })
})

describe('la descripción de una ficha', () => {
  it('entra en lo que muestra el buscador', () => {
    expect(descripcionDeProducto(PH2).length).toBeLessThanOrEqual(LARGO_DESCRIPCION)
  })

  it('usa la del catálogo cuando existe: está escrita para una persona', () => {
    expect(descripcionDeProducto(PH2)).toContain('La más usada para montaje general')
  })

  it('sin descripción, se arma con lo que distingue al producto', () => {
    const d = descripcionDeProducto({ ...PH2, descripcion: null })
    expect(d).toContain('Puntas y tubos')
    expect(d).toContain('SPEEDRILL')
    expect(d).toContain('SP.PH2')
  })

  it('dos productos distintos no tienen la misma descripción', () => {
    // Es el punto entero: nueve mil páginas con el mismo texto se leen como
    // una sola repetida nueve mil veces.
    const a = descripcionDeProducto({ ...PH2, descripcion: null })
    const b = descripcionDeProducto({
      ...PH2,
      sku: 'SP.PH3',
      nombre: 'SPEEDRILL PH3 PHILLIPS',
      descripcion: null,
      atributos: { largo: '50', medida: '3', encastre: '1/4 HEX BIT' },
    })
    expect(a).not.toBe(b)
  })

  it('sin atributos ni descripción, igual dice algo', () => {
    const d = descripcionDeProducto({ nombre: 'X', sku: 'X1', atributos: null })
    expect(d.length).toBeGreaterThan(0)
  })
})

describe('los atributos, dichos como los diría alguien', () => {
  it('traduce las claves que no son palabras', () => {
    expect(nombreDeAtributo('torq_max')).toBe('Torque máximo')
    expect(nombreDeAtributo('min_kg')).toBe('Desde')
  })

  it('una clave sin traducción se deja presentable', () => {
    expect(nombreDeAtributo('color_mango')).toBe('Color mango')
  })

  it('arma una frase, no un objeto', () => {
    expect(rasgosLegibles({ encastre: '1/4 HEX', medida: '2' })).toBe('Encastre 1/4 HEX, medida 2')
  })

  it('las listas se unen y lo que no es un valor se descarta', () => {
    expect(valorLegible(['macho', 'magnético'])).toBe('macho, magnético')
    expect(valorLegible({ a: 1 })).toBe('')
    expect(valorLegible(null)).toBe('')
  })

  it('sin atributos no inventa nada', () => {
    expect(rasgosLegibles(null)).toBe('')
    expect(rasgosLegibles({})).toBe('')
  })
})

describe('la categoría', () => {
  it('su título y su descripción entran', () => {
    expect(tituloDeCategoria('Puntas y tubos').length).toBeLessThanOrEqual(LARGO_TITULO)
    expect(descripcionDeCategoria('Puntas y tubos', 8623).length).toBeLessThanOrEqual(
      LARGO_DESCRIPCION,
    )
  })

  it('la descripción dice cuántos hay, que es lo que no dice nadie más', () => {
    expect(descripcionDeCategoria('Balanceadores', 376)).toContain('376')
  })
})

describe('los datos estructurados', () => {
  const d = datosEstructurados(PH2, 'https://app.buscatools.com/productos/puntas-y-tubos/speedrill-ph2-phillips')

  it('declara que esto es un producto', () => {
    expect(d['@type']).toBe('Product')
    expect(d['sku']).toBe('SP.PH2')
    expect(d['brand']).toEqual({ '@type': 'Brand', name: 'SPEEDRILL' })
  })

  it('NO declara oferta: no hay precio, y una oferta vacía es una mentira', () => {
    // Declarar `offers` con precio cero es decirle al buscador algo falso
    // sobre el producto, y eso se castiga.
    expect(d['offers']).toBeUndefined()
    expect(JSON.stringify(d)).not.toContain('price')
  })

  it('lleva los atributos como propiedades, con su nombre legible', () => {
    expect(d['additionalProperty']).toEqual(
      expect.arrayContaining([{ '@type': 'PropertyValue', name: 'Encastre', value: '1/4 HEX BIT' }]),
    )
  })

  it('lo que no existe no se declara vacío', () => {
    const pelado = datosEstructurados({ nombre: 'X', sku: 'X1' }, 'https://x/y')
    expect('brand' in pelado).toBe(false)
    expect('image' in pelado).toBe(false)
    expect('additionalProperty' in pelado).toBe(false)
  })
})
