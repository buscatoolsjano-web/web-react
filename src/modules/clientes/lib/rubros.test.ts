import { describe, expect, it } from 'vitest'
import { opcionesDeRubro, RUBROS_SUGERIDOS } from './rubros'

describe('rubros', () => {
  it('son los cuatro del sistema anterior, en su orden', () => {
    expect([...RUBROS_SUGERIDOS]).toEqual([
      'Gomería / Neumáticos',
      'Industrial / Metalúrgica',
      'Automotriz / Taller mecánico',
      'Herramientas / Ferretería',
    ])
  })

  it('sin rubro previo, las opciones son las cuatro', () => {
    expect(opcionesDeRubro(null)).toHaveLength(4)
    expect(opcionesDeRubro('')).toHaveLength(4)
  })

  it('un rubro que ya está no se duplica', () => {
    expect(opcionesDeRubro('Gomería / Neumáticos')).toHaveLength(4)
  })

  it('un rubro que NO está se agrega adelante, para no perderlo al guardar', () => {
    const o = opcionesDeRubro('Minería')
    expect(o[0]).toBe('Minería')
    expect(o).toHaveLength(5)
  })
})
