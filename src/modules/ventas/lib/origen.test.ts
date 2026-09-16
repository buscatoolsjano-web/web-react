import { describe, expect, it } from 'vitest'
import { presentarOrigen } from './origen'

const etiquetas = (o: Parameters<typeof presentarOrigen>[0]) => presentarOrigen(o).map((e) => e.texto)

describe('presentarOrigen', () => {
  it('lo que vino de STEL lo dice; es el caso de 304 de las 306 cotizaciones', () => {
    expect(etiquetas({ externalSource: 'stel', esHistorico: true, serie: 'COTI' })).toEqual([
      'Migrado desde STEL',
    ])
  })

  it('sin external_source pero importado es la migración del sistema anterior', () => {
    expect(etiquetas({ externalSource: null, esHistorico: true, serie: 'COTI' })).toEqual([
      'Migrado del sistema anterior',
    ])
  })

  it('lo que no vino de ningún lado lo emitió el ERP', () => {
    expect(etiquetas({ externalSource: null, esHistorico: false, serie: 'COTI' })).toEqual([
      'Emitido en el ERP',
    ])
  })

  it('un remito de la serie RT-ML suma el canal, sin perder de dónde vino', () => {
    expect(etiquetas({ externalSource: 'stel', esHistorico: true, serie: 'RT-ML' })).toEqual([
      'MercadoLibre',
      'Migrado desde STEL',
    ])
  })

  it('siempre devuelve al menos una etiqueta: el origen nunca queda en blanco', () => {
    expect(presentarOrigen({ externalSource: null, esHistorico: false, serie: null }).length).toBe(1)
  })
})
