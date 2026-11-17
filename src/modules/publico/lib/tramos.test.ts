import { describe, expect, it } from 'vitest'
import { esNumerico, etiquetaDeEncastre, etiquetaDeRango, redondearLindo, tramoActivo, tramosDe } from './tramos'

const largos = [
  ['25', 1200], ['28', 40], ['30', 300], ['32', 200], ['35', 150], ['38', 90], ['41', 60], ['50', 900],
  ['51', 120], ['70', 400], ['75', 150], ['89', 100], ['90', 300], ['100', 350], ['110', 20], ['150', 260],
  ['152', 80], ['200', 40], ['300', 15],
].map(([valor, cuantos]) => ({ valor: String(valor), cuantos: Number(cuantos) }))

describe('tramosDe', () => {
  const t = tramosDe(largos, 'mm')

  it('arma pocos tramos legibles que cubren todos los productos', () => {
    expect(t.length).toBeGreaterThanOrEqual(3)
    expect(t.length).toBeLessThanOrEqual(6)
    expect(t.reduce((a, x) => a + x.cantidad, 0)).toBe(largos.reduce((a, x) => a + x.cuantos, 0))
    expect(t[0]!.etiqueta).toMatch(/^Hasta \d+ mm$/)
    expect(t.at(-1)!.etiqueta).toMatch(/^Más de \d+ mm$/)
  })

  it('los tramos no se pisan: el siguiente empieza donde termina el anterior', () => {
    for (let i = 1; i < t.length; i++) {
      expect(t[i]!.min).toBe((t[i - 1]!.max ?? 0) + 1)
    }
  })

  it('con pocos valores distintos no hace tramos', () => {
    expect(tramosDe([{ valor: '25', cuantos: 3 }, { valor: '50', cuantos: 2 }], 'mm')).toEqual([])
  })

  it('reconoce el tramo elegido', () => {
    expect(tramoActivo(t, { min: t[1]!.min, max: t[1]!.max })?.id).toBe(t[1]!.id)
    expect(tramoActivo(t, undefined)).toBeUndefined()
  })
})

describe('auxiliares', () => {
  it('redondea a números lindos', () => {
    expect(redondearLindo(23)).toBe(25)
    expect(redondearLindo(41)).toBe(50)
    expect(redondearLindo(89)).toBe(100)
    expect(redondearLindo(152)).toBe(200)
    expect(redondearLindo(1.35)).toBe(1.5)
  })

  it('distingue un atributo numérico de uno de texto', () => {
    expect(esNumerico(largos)).toBe(true)
    expect(esNumerico([{ valor: 'T25', cuantos: 5 }, { valor: '13 mm', cuantos: 5 }])).toBe(false)
  })

  it('dice un rango ya puesto igual que su tramo', () => {
    expect(etiquetaDeRango({ min: 26, max: 50 }, 'mm')).toBe('26 a 50 mm')
    expect(etiquetaDeRango({ min: null, max: 25 }, 'mm')).toBe('Hasta 25 mm')
    expect(etiquetaDeRango({ min: 101, max: null }, 'mm')).toBe('Más de 100 mm')
    expect(etiquetaDeRango({ min: 1.500001, max: 3 }, 'kg')).toBe('1,5 a 3 kg')
  })

  it('dice el encastre en castellano', () => {
    expect(etiquetaDeEncastre('1/4 HEX')).toBe('1/4" hexagonal')
    expect(etiquetaDeEncastre('1-1/2 SQ')).toBe('1-1/2" cuadrado')
    expect(etiquetaDeEncastre('otra cosa')).toBe('otra cosa')
  })
})
