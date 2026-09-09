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
  it('F15 · no se dibuja si no hay ningún subtipo', () => {
    // `otros`: 12.588 productos sin product_type.
    expect(mostrarFacetaSubtipo([], 'Otros')).toBe(false)
  })

  it('F9 · no se dibuja si el único subtipo repite el nombre de la categoría', () => {
    // `balanceador` → «Balanceador»: un solo hijo con el nombre del padre no
    // divide nada.
    expect(
      mostrarFacetaSubtipo([{ valor: 'Balanceador', etiqueta: 'Balanceador', cantidad: 376 }],
        'Balanceador'),
    ).toBe(false)
  })

  it('ignora acentos y mayúsculas al comparar', () => {
    expect(
      mostrarFacetaSubtipo(
        [{ valor: 'Llave dinamométrica', etiqueta: 'Llave dinamométrica', cantidad: 2 }],
        'Llave dinamometrica',
      ),
    ).toBe(false)
  })

  it('sí se dibuja si el único subtipo NO es el nombre de la categoría', () => {
    // `llave-de-impacto` → «Gatillo».
    expect(
      mostrarFacetaSubtipo([{ valor: 'Gatillo', etiqueta: 'Gatillo', cantidad: 7 }],
        'Llave de impacto'),
    ).toBe(true)
  })

  it('F2 · se dibuja cuando hay varios subtipos', () => {
    expect(
      mostrarFacetaSubtipo(
        [
          { valor: 'Embocadura', etiqueta: 'Embocadura', cantidad: 4279 },
          { valor: 'Torx', etiqueta: 'Torx', cantidad: 463 },
        ],
        'Punta',
      ),
    ).toBe(true)
  })

  it('sin categoría elegida, se dibuja igual', () => {
    expect(mostrarFacetaSubtipo([{ valor: 'Torx', etiqueta: 'Torx', cantidad: 1 }], null)).toBe(true)
  })
})
