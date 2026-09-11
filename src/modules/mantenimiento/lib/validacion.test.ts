import { describe, expect, it } from 'vitest'
import { errorDe, validarActivo, validarOrden } from './validacion'
import type { DatosActivo } from '../services/activos'
import type { DatosOrden } from '../services/ordenes'

const ACTIVO: DatosActivo = {
  duenoId: null,
  productoId: null,
  identificador: '',
  serie: '',
  marca: '',
  modelo: '',
  tipo: '',
  ciudad: '',
  provincia: '',
  garantiaDesde: '',
  garantiaHasta: '',
  bajoContrato: false,
  notas: '',
}

const ORDEN: DatosOrden = {
  activoId: 'a1',
  clienteId: 'c1',
  tipoServicio: 'corrective',
  motivoIngreso: '',
  condicionVisual: '',
  tecnicoId: null,
  fechaIngreso: '2026-09-10',
  notasDiagnostico: '',
}

describe('validarActivo', () => {
  it('un equipo vacío es válido: nada es obligatorio', () => {
    // Es la regla de fondo. El serial, el dueño y el producto son nullable en
    // el schema, así que exigirlos acá inventaría una regla que la base no
    // tiene y dejaría afuera casos reales del sistema anterior.
    expect(validarActivo(ACTIVO)).toEqual([])
  })

  it('un equipo sin serie y sin dueño pasa', () => {
    expect(validarActivo({ ...ACTIVO, serie: '', duenoId: null })).toEqual([])
  })

  it('una fecha de garantía mal escrita se rechaza', () => {
    const e = validarActivo({ ...ACTIVO, garantiaDesde: 'ayer' })
    expect(errorDe(e, 'garantiaDesde')).toMatch(/no es válida/)
  })

  it('el 30 de febrero no existe', () => {
    const e = validarActivo({ ...ACTIVO, garantiaHasta: '2026-02-30' })
    expect(errorDe(e, 'garantiaHasta')).toMatch(/no es válida/)
  })

  it('la garantía no puede terminar antes de empezar', () => {
    const e = validarActivo({
      ...ACTIVO,
      garantiaDesde: '2026-06-01',
      garantiaHasta: '2026-01-01',
    })
    expect(errorDe(e, 'garantiaHasta')).toMatch(/anterior/)
  })

  it('el mismo día en los dos extremos es válido', () => {
    expect(
      validarActivo({ ...ACTIVO, garantiaDesde: '2026-06-01', garantiaHasta: '2026-06-01' }),
    ).toEqual([])
  })
})

describe('validarOrden', () => {
  it('una orden completa es válida', () => {
    expect(validarOrden(ORDEN)).toEqual([])
  })

  it('exige el equipo', () => {
    expect(errorDe(validarOrden({ ...ORDEN, activoId: '' }), 'activoId')).toBeTruthy()
  })

  it('exige el cliente, y explica que queda congelado', () => {
    const mensaje = errorDe(validarOrden({ ...ORDEN, clienteId: '' }), 'clienteId')
    expect(mensaje).toBeTruthy()
    expect(mensaje).toMatch(/queda guardado en la orden/)
  })

  it('exige el tipo de servicio y la fecha de ingreso', () => {
    expect(errorDe(validarOrden({ ...ORDEN, tipoServicio: '' }), 'tipoServicio')).toBeTruthy()
    expect(errorDe(validarOrden({ ...ORDEN, fechaIngreso: '' }), 'fechaIngreso')).toBeTruthy()
  })

  it('una fecha de ingreso inválida se rechaza como inválida, no como vacía', () => {
    expect(errorDe(validarOrden({ ...ORDEN, fechaIngreso: '10/09/2026' }), 'fechaIngreso')).toMatch(
      /no es válida/,
    )
  })

  it('el técnico y el motivo son opcionales', () => {
    expect(validarOrden({ ...ORDEN, tecnicoId: null, motivoIngreso: '' })).toEqual([])
  })
})

describe('errorDe', () => {
  it('devuelve null cuando el campo está bien', () => {
    expect(errorDe(validarOrden(ORDEN), 'activoId')).toBeNull()
  })
})
