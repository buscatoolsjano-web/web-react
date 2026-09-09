import { describe, expect, it } from 'vitest'
import { clasificarFaceta, mostrarFacetaSubtipo } from './clasificarFaceta'

const v = (...valores: [string, number][]) =>
  valores.map(([value, count]) => ({ value, count }))

describe('clasificarFaceta', () => {
  it('pocas opciones → lista seleccionable', () => {
    // `carcasa` tiene 6 valores en el catálogo real.
    const f = clasificarFaceta('carcasa', 'Material de carcasa', null,
      v(['ALUMINIO', 292], ['INOXIDABLE', 56], ['NYLON', 9]))
    expect(f.clase).toBe('enum')
    expect(f.opciones).toHaveLength(3)
    expect(f.opciones[0]).toEqual({ valor: 'ALUMINIO', etiqueta: 'ALUMINIO', cantidad: 292 })
  })

  it('muchas opciones y TODAS numéricas → rango', () => {
    // `largo`: 176 valores, todos numéricos, de 3 a 600 mm.
    const muchos = Array.from({ length: 40 }, (_, i): [string, number] => [String(i + 3), 10])
    const f = clasificarFaceta('largo', 'Largo', 'mm', v(...muchos))
    expect(f.clase).toBe('range')
    expect(f.min).toBe(3)
    expect(f.max).toBe(42)
  })

  it('muchas opciones pero NO todas numéricas → lista, no rango', () => {
    // `medida`: 258 valores que mezclan métrico (10), imperial (1/2") y
    // calibres (#2). Un rango numérico daría resultados falsos.
    const mezcla: [string, number][] = [
      ...Array.from({ length: 20 }, (_, i): [string, number] => [String(i), 5]),
      ['1/2"', 100],
      ['#2', 112],
    ]
    expect(clasificarFaceta('medida', 'Medida', null, v(...mezcla)).clase).toBe('enum')
  })

  it('rpm NO se ofrece como rango aunque esté declarado number', () => {
    // 22 de sus 24 valores son intervalos de texto: `0-2600`, `50-800`.
    const rpm: [string, number][] = [
      ['-', 9], ['0-2600', 4], ['50-800', 4], ['0-2200', 3], ['262-375', 3],
      ['350-500', 3], ['50-1200', 3], ['50-600', 3], ['525-750', 3],
      ['700-1000', 3], ['840-1200', 3], ['110-1200', 2], ['210-300', 2],
      ['100', 1], ['160', 1],
    ]
    const f = clasificarFaceta('rpm', 'Revoluciones', 'rpm', v(...rpm))
    expect(f.clase).toBe('enum')
    expect(f.min).toBeNull()
  })

  it('un solo valor numérico no alcanza para ser rango', () => {
    expect(clasificarFaceta('x', 'X', null, v(['5', 1])).clase).toBe('enum')
  })

  it('acepta la coma decimal', () => {
    const muchos = Array.from({ length: 20 }, (_, i): [string, number] => [`${i},5`, 1])
    expect(clasificarFaceta('largo', 'Largo', 'mm', v(...muchos)).clase).toBe('range')
  })
})

describe('mostrarFacetaSubtipo', () => {
  const op = (valor: string, cantidad: number) => ({ valor, etiqueta: valor, cantidad })

  it('F15 · no se dibuja si no hay ningún subtipo', () => {
    // `otros`: 12.588 productos sin product_type.
    expect(mostrarFacetaSubtipo([], 12588, true)).toBe(false)
  })

  it('no se dibuja sin categoría elegida: serían los 40 subtipos del catálogo', () => {
    const cuarenta = Array.from({ length: 40 }, (_, i) => op('T' + i, 10))
    expect(mostrarFacetaSubtipo(cuarenta, 21772, false)).toBe(false)
  })

  it('pero sí se dibuja sin categoría si ya hay subtipos elegidos', () => {
    // Para que un link compartido con ?tipo=Gatillo y sin categoría se pueda
    // seguir editando.
    expect(mostrarFacetaSubtipo([op('Gatillo', 40)], 40, false, ['Gatillo'])).toBe(true)
  })

  it('F9 · no se dibuja si un único subtipo cubre TODOS los resultados', () => {
    // `balanceador` → «Balanceador», 376 de 376: elegirlo devolvería
    // exactamente lo mismo que ya se ve.
    expect(mostrarFacetaSubtipo([op('Balanceador', 376)], 376, true)).toBe(false)
  })

  it('la regla es por CONTEO y no por nombre', () => {
    // La categoría se llama «Balanceadores» y el subtipo «Balanceador»:
    // comparar nombres fallaba por el plural. El conteo no.
    expect(mostrarFacetaSubtipo([op('Llave dinamométrica', 2)], 2, true)).toBe(false)
    expect(mostrarFacetaSubtipo([op('Cualquier cosa', 7)], 7, true)).toBe(false)
  })

  it('un subtipo elegido nunca se esconde, o quedaría trabado', () => {
    // Al filtrar por Gatillo, Gatillo pasa a cubrir el 100 % del resultado.
    // Si la regla del conteo lo escondiera, no habría forma de quitarlo.
    expect(mostrarFacetaSubtipo([op('Gatillo', 40)], 40, true, ['Gatillo'])).toBe(true)
  })

  it('sí se dibuja si el único subtipo NO cubre todo', () => {
    // Quedan productos sin subtipo, así que elegirlo sí acota.
    expect(mostrarFacetaSubtipo([op('Gatillo', 29)], 129, true)).toBe(true)
  })

  it('F2 · se dibuja cuando hay varios subtipos', () => {
    expect(
      mostrarFacetaSubtipo([op('Embocadura', 4279), op('Torx', 463)], 8623, true),
    ).toBe(true)
  })
})
