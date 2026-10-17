import { describe, expect, it } from 'vitest'
import { cortesDePagina } from './paginasPdf'
import { nombreDePdf } from './pdfDeHoja'

/**
 * El reparto en páginas del PDF que se adjunta al mail (Fase 84).
 *
 * Lo que se prueba es la regla que hace que el PDF no se vea roto: que ningún
 * corte caiga en el medio de una fila de producto. Y las dos formas de romper
 * esto que no se ven hasta que pasan: una página de más al final —vacía o con
 * un milímetro— y el bucle infinito cuando una fila es más alta que la hoja.
 */
describe('El reparto en páginas', () => {
  it('lo que entra en una hoja es una sola página', () => {
    expect(cortesDePagina(900, 1000)).toEqual([{ desde: 0, hasta: 900 }])
  })

  it('lo que mide exactamente una hoja también', () => {
    expect(cortesDePagina(1000, 1000)).toEqual([{ desde: 0, hasta: 1000 }])
  })

  it('sin bordes donde cortar, corta parejo', () => {
    expect(cortesDePagina(2500, 1000)).toEqual([
      { desde: 0, hasta: 1000 },
      { desde: 1000, hasta: 2000 },
      { desde: 2000, hasta: 2500 },
    ])
  })

  /* Lo que importa: la fila que no entra baja entera. */
  it('corta en el último borde de fila que entra', () => {
    const filas = [200, 400, 600, 800, 950, 1100, 1300]
    expect(cortesDePagina(1300, 1000, filas)).toEqual([
      { desde: 0, hasta: 950 },
      { desde: 950, hasta: 1300 },
    ])
  })

  it('los bordes pueden venir desordenados y repetidos', () => {
    const filas = [950, 200, 950, 600, 400]
    expect(cortesDePagina(1300, 1000, filas)).toEqual([
      { desde: 0, hasta: 950 },
      { desde: 950, hasta: 1300 },
    ])
  })

  /* Una fila más alta que la hoja no se puede respetar. Antes que colgarse,
     se la parte: un PDF feo es mejor que una pestaña trabada. */
  it('una fila más alta que la hoja se parte, sin colgarse', () => {
    // Un solo borde, a 2.400: la fila ocupa dos hojas y media y no hay por
    // dónde cortarla bien. Se corta parejo y se sigue.
    expect(cortesDePagina(2500, 1000, [2400])).toEqual([
      { desde: 0, hasta: 1000 },
      { desde: 1000, hasta: 2000 },
      { desde: 2000, hasta: 2500 },
    ])
  })

  /* Un borde justo en el final no tiene que dejar una página de un pelo. */
  it('no deja una página de sobra al final', () => {
    const paginas = cortesDePagina(2000.4, 1000, [1000, 2000])
    expect(paginas).toHaveLength(2)
    expect(paginas[1]).toEqual({ desde: 1000, hasta: 2000.4 })
  })

  it('las páginas se encadenan sin huecos ni solapes', () => {
    const paginas = cortesDePagina(4321, 1000, [300, 900, 1800, 2400, 3100, 3900])
    expect(paginas[0]!.desde).toBe(0)
    expect(paginas[paginas.length - 1]!.hasta).toBe(4321)
    for (let i = 1; i < paginas.length; i++) {
      expect(paginas[i]!.desde).toBe(paginas[i - 1]!.hasta)
      expect(paginas[i]!.hasta).toBeGreaterThan(paginas[i]!.desde)
    }
  })

  it('una hoja vacía no genera páginas', () => {
    expect(cortesDePagina(0, 1000)).toEqual([])
    expect(cortesDePagina(1000, 0)).toEqual([])
  })
})

/*
 * El nombre del archivo viaja por mail y lo ve el cliente: sin acentos ni
 * espacios, y con el número del documento para que se entienda cuál es.
 */
describe('El nombre del PDF', () => {
  it('es el tipo y el número', () => {
    expect(nombreDePdf('cotizacion', 'COT-BTS00007')).toBe('Cotizacion-COT-BTS00007.pdf')
    expect(nombreDePdf('pedido', 'PDV01330')).toBe('Pedido-PDV01330.pdf')
    expect(nombreDePdf('entrega', 'RT0001')).toBe('Remito-RT0001.pdf')
  })

  it('limpia lo que no sobrevive a un adjunto', () => {
    expect(nombreDePdf('cotizacion', 'COTI 02558/A ñ')).toBe('Cotizacion-COTI-02558-A-n.pdf')
  })
})
